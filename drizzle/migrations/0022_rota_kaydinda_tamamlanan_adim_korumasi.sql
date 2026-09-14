-- Rota yeniden kaydedilirken önceki planda tamamlanmış/atlanmış adımların durumu korunur.
CREATE OR REPLACE FUNCTION public.route_save_plan(
  _member_id uuid, _steps jsonb, _reason text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; m public.team_members; prev public.route_plans;
        plan_id uuid; v integer; s jsonb; i integer := 0; carried public.route_step_status;
BEGIN
  uid := public.assert_permission('team.manage');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'route_save_plan',
    jsonb_build_object('member_id', _member_id, 'steps', _steps,
                       'reason', NULLIF(btrim(COALESCE(_reason,'')),'')));
  IF NOT cmd.is_new THEN RETURN cmd.prior::uuid; END IF;

  SELECT * INTO m FROM public.team_members WHERE id = _member_id FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Takım üyesi yok.'; END IF;
  IF NOT m.is_active THEN RAISE EXCEPTION 'GECERSIZ: Pasif üyeye rota kaydedilemez.'; END IF;
  IF jsonb_typeof(_steps) <> 'array' OR jsonb_array_length(_steps) = 0 THEN
    RAISE EXCEPTION 'GECERSIZ: Rota en az bir adım içermelidir.';
  END IF;

  SELECT * INTO prev FROM public.route_plans
   WHERE team_member_id = _member_id AND status = 'yururlukte' FOR UPDATE;
  IF prev.id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.route_steps
                WHERE plan_id = prev.id AND status = 'kuyrukta') THEN
      RAISE EXCEPTION 'URETIMDE: Kuyrukta adımı olan üyenin rotası bu aşamada değiştirilemez.';
    END IF;
  END IF;

  SELECT COALESCE(max(version), 0) + 1 INTO v FROM public.route_plans WHERE team_member_id = _member_id;
  INSERT INTO public.route_plans (team_member_id, version, status, reason, created_by)
  VALUES (_member_id, v, 'yururlukte', NULLIF(btrim(COALESCE(_reason,'')),''), uid)
  RETURNING id INTO plan_id;

  FOR s IN SELECT * FROM jsonb_array_elements(_steps) LOOP
    i := i + 1;
    IF COALESCE((s->>'skipped')::boolean, false)
       AND NULLIF(btrim(COALESCE(s->>'skip_reason','')),'') IS NULL THEN
      RAISE EXCEPTION 'GECERSIZ: Atlanan adım için gerekçe zorunludur.';
    END IF;

    carried := NULL;
    IF prev.id IS NOT NULL THEN
      SELECT rs.status INTO carried FROM public.route_steps rs
       WHERE rs.plan_id = prev.id AND rs.seq = i
         AND rs.station_id = (s->>'station_id')::uuid
         AND rs.status IN ('tamamlandi','atlandi')
       LIMIT 1;
    END IF;

    INSERT INTO public.route_steps (plan_id, seq, station_id, op_label, skipped, skip_reason, status)
    VALUES (plan_id, i, (s->>'station_id')::uuid,
      COALESCE(NULLIF(btrim(COALESCE(s->>'op_label','')),''), 'İşlem'),
      COALESCE((s->>'skipped')::boolean, false),
      NULLIF(btrim(COALESCE(s->>'skip_reason','')),''),
      COALESCE(carried,
        CASE WHEN COALESCE((s->>'skipped')::boolean, false) THEN 'atlandi'::public.route_step_status
             ELSE 'planlandi'::public.route_step_status END));
  END LOOP;

  IF prev.id IS NOT NULL THEN
    UPDATE public.route_steps SET status = 'superseded'
     WHERE plan_id = prev.id AND status = 'planlandi';
    UPDATE public.route_plans SET status = 'superseded' WHERE id = prev.id;
  END IF;

  PERFORM public.write_audit('route.plan_saved', 'route_plans', plan_id::text,
    CASE WHEN prev.id IS NOT NULL THEN jsonb_build_object('prev_plan', prev.id, 'prev_version', prev.version) END,
    jsonb_build_object('member_id', _member_id, 'version', v, 'steps', _steps), _reason);
  PERFORM public.command_finish(_idempotency_key, plan_id::text);
  RETURN plan_id;
END;
$$;