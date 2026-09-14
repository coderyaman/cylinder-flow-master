CREATE OR REPLACE FUNCTION public.quality_resume_flow(_issue_id uuid, _idempotency_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid; cmd record; iss public.quality_issues; op public.operations;
        step public.route_steps; nxt public.route_steps; queued jsonb := NULL;
        ikey text := coalesce(_idempotency_key, gen_random_uuid()::text);
BEGIN
  uid := public.assert_permission('rework.approve');
  SELECT * INTO cmd FROM public.command_begin(ikey, 'quality_resume_flow',
    jsonb_build_object('issue', _issue_id));
  IF NOT cmd.is_new THEN RETURN jsonb_build_object('issue_id', _issue_id, 'replayed', true); END IF;

  SELECT * INTO iss FROM public.quality_issues WHERE id = _issue_id FOR UPDATE;
  IF iss.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Kayıt yok.'; END IF;
  IF iss.decision IS DISTINCT FROM 'devam' THEN
    RAISE EXCEPTION 'GECERSIZ: Önce "mevcut akışa devam" kararı verilmelidir.';
  END IF;

  SELECT * INTO op FROM public.operations WHERE id = iss.operation_id FOR UPDATE;
  IF op.id IS NOT NULL AND op.status = 'bloke' AND op.block_resolved_at IS NULL THEN
    UPDATE public.operations
       SET block_resolved_at = now(),
           block_resolved_by = uid,
           machine_held = false,
           status = CASE WHEN op.finished_at IS NULL THEN 'devam'::public.op_status ELSE op.status END
     WHERE id = op.id;

    SELECT * INTO step FROM public.route_steps WHERE id = op.route_step_id FOR UPDATE;
    IF step.id IS NOT NULL AND step.status = 'kuyrukta' THEN
      queued := jsonb_build_object('step_id', step.id, 'op_label', step.op_label);
    ELSIF step.id IS NOT NULL AND step.status = 'tamamlandi' THEN
      SELECT * INTO nxt FROM public.route_steps
       WHERE plan_id = step.plan_id AND status = 'planlandi' AND seq > step.seq
       ORDER BY seq LIMIT 1 FOR UPDATE;
      IF nxt.id IS NOT NULL THEN
        UPDATE public.route_steps SET status = 'kuyrukta', queued_at = now() WHERE id = nxt.id;
        queued := jsonb_build_object('step_id', nxt.id, 'op_label', nxt.op_label);
      END IF;
    END IF;
  END IF;

  UPDATE public.operation_notes SET acknowledged_at = now(), acknowledged_by = uid
   WHERE id = iss.note_id AND acknowledged_at IS NULL;
  UPDATE public.quality_issues SET resolved_at = now() WHERE id = _issue_id;

  PERFORM public.write_audit('quality.resumed', 'quality_issues', _issue_id::text, NULL,
    jsonb_build_object('operation_id', iss.operation_id, 'queued', queued),
    'İnceleme sonrası mevcut akışa devam kararı uygulandı.');
  PERFORM public.command_finish(ikey, _issue_id::text);
  RETURN jsonb_build_object('issue_id', _issue_id, 'queued', queued, 'replayed', false);
END;
$$;