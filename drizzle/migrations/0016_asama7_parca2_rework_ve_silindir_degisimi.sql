-- Aşama 7 / Parça 2: onaylı rework yürütme ve silindir değiştirme.
ALTER TABLE public.route_plans
  ADD COLUMN IF NOT EXISTS quality_issue_id uuid REFERENCES public.quality_issues(id),
  ADD COLUMN IF NOT EXISTS rework_round integer;
CREATE UNIQUE INDEX IF NOT EXISTS route_plans_quality_issue_uniq
  ON public.route_plans (quality_issue_id) WHERE quality_issue_id IS NOT NULL;

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS removed_reason text,
  ADD COLUMN IF NOT EXISTS replaced_by_member_id uuid REFERENCES public.team_members(id),
  ADD COLUMN IF NOT EXISTS replaces_member_id uuid REFERENCES public.team_members(id);

-- (A) Rework önizlemesi. Üretimi etkilemez.
CREATE OR REPLACE FUNCTION public.rework_suggest(_issue_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE iss public.quality_issues; m public.team_members; dcode text; start_code text;
        st record; i integer := 0; steps jsonb := '[]'::jsonb; ret_label text := NULL;
BEGIN
  PERFORM public.assert_permission('rework.approve');
  SELECT * INTO iss FROM public.quality_issues WHERE id = _issue_id;
  IF iss.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Kayıt yok.'; END IF;
  SELECT * INTO m FROM public.team_members WHERE id = iss.team_member_id;
  SELECT code INTO dcode FROM public.stations WHERE id = iss.detected_station_id;

  -- Gravür hatasında doğrudan Gravür'e dönülmez; yeniden hazırlama döngüsü uygulanır.
  start_code := CASE WHEN dcode = 'GRAVUR' THEN 'SOKME' ELSE dcode END;

  FOR st IN
    SELECT s.* FROM public.stations s
     WHERE s.is_active
       AND s.sort_order >= (SELECT sort_order FROM public.stations WHERE code = start_code)
       AND s.code IN ('SOKME','BAKIR','TASLAMA','CFM','GRAVUR','KROM','TORNA')
     ORDER BY s.sort_order
  LOOP
    i := i + 1;
    steps := steps || jsonb_build_object('seq', i, 'station_id', st.id,
      'station_code', st.code, 'station_name', st.name,
      'op_label', CASE WHEN st.code = start_code THEN st.name || ' (tekrar işlem)' ELSE st.name END,
      'skipped', false, 'skip_reason', NULL);
    IF ret_label IS NULL AND st.code <> start_code THEN ret_label := st.name; END IF;
  END LOOP;

  RETURN jsonb_build_object('issue_id', _issue_id, 'member_id', m.id,
    'detected_station', dcode, 'start_station', start_code,
    'gravure_loop', dcode = 'GRAVUR', 'return_point', ret_label,
    'responsibility', iss.responsibility, 'billable', iss.billable, 'steps', steps);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rework_suggest(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rework_suggest(uuid) TO authenticated, service_role;

-- (B) Onaylı rework yürütme.
CREATE OR REPLACE FUNCTION public.rework_approve(
  _issue_id uuid, _steps jsonb, _reason text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid; cmd record; iss public.quality_issues; m public.team_members;
        prev public.route_plans; existing public.route_plans; new_plan uuid;
        v integer; rnd integer; s jsonb; i integer := 0; first_step uuid;
        first_code text; held boolean; ikey text := COALESCE(_idempotency_key, gen_random_uuid()::text);
BEGIN
  uid := public.assert_permission('rework.approve');
  SELECT * INTO cmd FROM public.command_begin(ikey, 'rework_approve',
    jsonb_build_object('issue', _issue_id, 'steps', _steps,
      'reason', NULLIF(btrim(COALESCE(_reason,'')),'')));
  IF NOT cmd.is_new THEN
    RETURN jsonb_build_object('plan_id', cmd.prior, 'replayed', true);
  END IF;

  SELECT * INTO iss FROM public.quality_issues WHERE id = _issue_id FOR UPDATE;
  IF iss.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Kayıt yok.'; END IF;
  IF iss.decision IS DISTINCT FROM 'rework' THEN
    RAISE EXCEPTION 'GECERSIZ: Önce "onaylı rework" kararı verilmelidir.';
  END IF;

  SELECT * INTO existing FROM public.route_plans WHERE quality_issue_id = _issue_id;
  IF existing.id IS NOT NULL THEN
    PERFORM public.command_finish(ikey, existing.id::text);
    RETURN jsonb_build_object('plan_id', existing.id, 'round_no', existing.rework_round,
                              'already_applied', true, 'replayed', false);
  END IF;

  IF jsonb_typeof(_steps) <> 'array' OR jsonb_array_length(_steps) = 0 THEN
    RAISE EXCEPTION 'GECERSIZ: Rework rotası en az bir adım içermelidir.';
  END IF;

  SELECT * INTO m FROM public.team_members WHERE id = iss.team_member_id FOR UPDATE;
  IF NOT m.is_active THEN RAISE EXCEPTION 'GECERSIZ: Üye takımdan çıkarılmış.'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.operations
                  WHERE team_member_id = m.id AND machine_held) INTO held;
  IF held THEN
    RAISE EXCEPTION 'GECERSIZ: Silindir makinede görünüyor. Önce makine bağını serbest bırakın.';
  END IF;

  SELECT code INTO first_code FROM public.stations
   WHERE id = ((_steps->0)->>'station_id')::uuid;
  IF first_code = 'GRAVUR'
     AND (SELECT code FROM public.stations WHERE id = iss.detected_station_id) = 'GRAVUR' THEN
    RAISE EXCEPTION 'GECERSIZ: Gravür hatasında doğrudan Gravür''e dönülemez; yeniden hazırlama adımları gerekir.';
  END IF;

  SELECT * INTO prev FROM public.route_plans
   WHERE team_member_id = m.id AND status = 'yururlukte' FOR UPDATE;
  IF prev.id IS NOT NULL THEN
    UPDATE public.route_steps SET status = 'superseded'
     WHERE plan_id = prev.id AND status IN ('planlandi','kuyrukta');
    UPDATE public.route_plans SET status = 'superseded' WHERE id = prev.id;
  END IF;

  UPDATE public.operations
     SET status = 'tamamlandi',
         result = COALESCE(result, 'sorunlu'),
         finished_at = COALESCE(finished_at, now()),
         finished_by = COALESCE(finished_by, uid),
         machine_held = false,
         block_resolved_at = COALESCE(block_resolved_at, now()),
         block_resolved_by = COALESCE(block_resolved_by, uid)
   WHERE team_member_id = m.id AND status = 'bloke';
  UPDATE public.operation_notes SET acknowledged_at = now(), acknowledged_by = uid
   WHERE team_member_id = m.id AND acknowledged_at IS NULL;

  SELECT COALESCE(max(version), 0) + 1 INTO v FROM public.route_plans WHERE team_member_id = m.id;
  SELECT COALESCE(max(rs.round_no), 1) + 1 INTO rnd
    FROM public.route_steps rs JOIN public.route_plans rp ON rp.id = rs.plan_id
   WHERE rp.team_member_id = m.id;

  INSERT INTO public.route_plans (team_member_id, version, status, reason, created_by,
                                  quality_issue_id, rework_round)
  VALUES (m.id, v, 'yururlukte',
          COALESCE(NULLIF(btrim(COALESCE(_reason,'')),''), 'Onaylı rework'), uid, _issue_id, rnd)
  RETURNING id INTO new_plan;

  FOR s IN SELECT * FROM jsonb_array_elements(_steps) LOOP
    i := i + 1;
    IF COALESCE((s->>'skipped')::boolean, false)
       AND NULLIF(btrim(COALESCE(s->>'skip_reason','')),'') IS NULL THEN
      RAISE EXCEPTION 'GECERSIZ: Atlanan adım için gerekçe zorunludur.';
    END IF;
    INSERT INTO public.route_steps (plan_id, seq, station_id, op_label, round_no,
                                    skipped, skip_reason, status)
    VALUES (new_plan, i, (s->>'station_id')::uuid,
      COALESCE(NULLIF(btrim(COALESCE(s->>'op_label','')),''), 'Tekrar işlem'), rnd,
      COALESCE((s->>'skipped')::boolean, false),
      NULLIF(btrim(COALESCE(s->>'skip_reason','')),''),
      CASE WHEN COALESCE((s->>'skipped')::boolean, false) THEN 'atlandi'::public.route_step_status
           ELSE 'planlandi'::public.route_step_status END);
  END LOOP;

  SELECT id INTO first_step FROM public.route_steps
   WHERE plan_id = new_plan AND status = 'planlandi' ORDER BY seq LIMIT 1;
  IF first_step IS NOT NULL THEN
    UPDATE public.route_steps SET status = 'kuyrukta', queued_at = now() WHERE id = first_step;
  END IF;

  UPDATE public.team_members SET proof_ready_at = NULL WHERE id = m.id;
  UPDATE public.teams SET proof_queued_at = NULL WHERE id = m.team_id;
  UPDATE public.quality_issues SET resolved_at = now() WHERE id = _issue_id;

  PERFORM public.write_audit('quality.rework_approved', 'route_plans', new_plan::text, NULL,
    jsonb_build_object('issue_id', _issue_id, 'member_id', m.id, 'version', v,
      'round_no', rnd, 'steps', _steps, 'responsibility', iss.responsibility,
      'billable', iss.billable), _reason);
  PERFORM public.command_finish(ikey, new_plan::text);
  RETURN jsonb_build_object('plan_id', new_plan, 'round_no', rnd, 'replayed', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.rework_approve(uuid, jsonb, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rework_approve(uuid, jsonb, text, text) TO authenticated, service_role;

-- (C) Silindir değiştirme.
CREATE OR REPLACE FUNCTION public.team_replace_member(
  _member_id uuid,
  _reason text,
  _replacement_receipt_id uuid DEFAULT NULL,
  _planned_ops public.planned_op[] DEFAULT '{}',
  _old_lifecycle public.cyl_lifecycle DEFAULT 'kontrol_bekliyor',
  _issue_id uuid DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid; cmd record; m public.team_members; ord public.orders; cart public.order_carts;
        rec public.cylinder_receipts; item_id uuid; new_member uuid; seq integer;
        iss public.quality_issues; ikey text := COALESCE(_idempotency_key, gen_random_uuid()::text);
        ready integer; total integer;
BEGIN
  uid := public.assert_permission('team.manage');
  SELECT * INTO cmd FROM public.command_begin(ikey, 'team_replace_member',
    jsonb_build_object('member', _member_id, 'receipt', _replacement_receipt_id,
      'ops', to_jsonb(COALESCE(_planned_ops,'{}'::public.planned_op[])),
      'lifecycle', _old_lifecycle, 'issue', _issue_id,
      'reason', NULLIF(btrim(COALESCE(_reason,'')),'')));
  IF NOT cmd.is_new THEN
    RETURN jsonb_build_object('member_id', cmd.prior, 'replayed', true);
  END IF;

  IF NULLIF(btrim(COALESCE(_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'GECERSIZ: Çıkarılma nedeni zorunludur.';
  END IF;
  IF _old_lifecycle NOT IN ('kontrol_bekliyor','tamir_bekliyor','hurda') THEN
    RAISE EXCEPTION 'GECERSIZ: Eski silindirin fiziksel durumu seçilmelidir.';
  END IF;

  SELECT * INTO m FROM public.team_members WHERE id = _member_id FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Takım üyesi yok.'; END IF;
  IF NOT m.is_active THEN RAISE EXCEPTION 'GECERSIZ: Üye zaten çıkarılmış.'; END IF;

  SELECT o.* INTO ord FROM public.orders o JOIN public.teams t ON t.order_id = o.id
   WHERE t.id = m.team_id;
  IF ord.closure_status = 'iptal' THEN RAISE EXCEPTION 'IPTAL_EDILMIS: Sipariş iptal edilmiş.'; END IF;
  SELECT * INTO cart FROM public.order_carts WHERE order_id = ord.id FOR UPDATE;

  UPDATE public.route_steps SET status = 'superseded'
   WHERE plan_id IN (SELECT id FROM public.route_plans
                      WHERE team_member_id = m.id AND status = 'yururlukte')
     AND status IN ('planlandi','kuyrukta');
  UPDATE public.route_plans SET status = 'superseded'
   WHERE team_member_id = m.id AND status = 'yururlukte';
  UPDATE public.operations
     SET status = 'tamamlandi', result = COALESCE(result,'sorunlu'),
         finished_at = COALESCE(finished_at, now()), finished_by = COALESCE(finished_by, uid),
         machine_held = false,
         block_resolved_at = COALESCE(block_resolved_at, now()),
         block_resolved_by = COALESCE(block_resolved_by, uid)
   WHERE team_member_id = m.id AND status IN ('devam','bloke');

  UPDATE public.team_members
     SET is_active = false, removed_at = now(), removed_by = uid,
         removed_reason = btrim(_reason), proof_ready_at = NULL
   WHERE id = m.id;

  IF m.receipt_id IS NOT NULL THEN
    UPDATE public.cylinder_receipts
       SET lifecycle = _old_lifecycle,
           usability = CASE WHEN _old_lifecycle = 'hurda' THEN 'kullanilamaz'::public.cyl_usability
                            ELSE 'sartli'::public.cyl_usability END,
           updated_by = uid
     WHERE id = m.receipt_id;
    UPDATE public.cylinder_reservations
       SET status = 'birakildi', released_at = now(), released_by = uid,
           release_reason = btrim(_reason)
     WHERE receipt_id = m.receipt_id AND order_id = ord.id AND status = 'aktif';
  END IF;

  IF _replacement_receipt_id IS NOT NULL THEN
    SELECT * INTO rec FROM public.cylinder_receipts WHERE id = _replacement_receipt_id FOR UPDATE;
    IF rec.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Yeni silindir kaydı yok.'; END IF;
    IF rec.customer_id <> ord.customer_id THEN
      RAISE EXCEPTION 'GECERSIZ: Silindir başka müşteriye ait.';
    END IF;
    IF rec.status = 'iptal' THEN RAISE EXCEPTION 'GECERSIZ: İptal edilmiş kabul kaydı seçilemez.'; END IF;
    IF rec.lifecycle NOT IN ('depoda','tamir_bekliyor') THEN
      RAISE EXCEPTION 'GECERSIZ: Silindir depoda uygun durumda değil (%).', rec.lifecycle;
    END IF;
    IF rec.lifecycle = 'tamir_bekliyor' AND NOT ('tamir' = ANY(COALESCE(_planned_ops,'{}'))) THEN
      RAISE EXCEPTION 'GECERSIZ: Tamir bekleyen silindir için tamir işi planlanmalıdır.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cylinder_reservations
                WHERE receipt_id = rec.id AND status = 'aktif') THEN
      RAISE EXCEPTION 'REZERVE: Silindir başka bir siparişe ayrılmış.';
    END IF;
    INSERT INTO public.cart_items (cart_id, kind, receipt_id, planned_ops, note, created_by)
    VALUES (cart.id, 'mevcut', rec.id, COALESCE(_planned_ops,'{}'),
            'Silindir değişimi ile eklendi.', uid)
    RETURNING id INTO item_id;
    INSERT INTO public.cylinder_reservations (receipt_id, order_id, cart_item_id, created_by)
    VALUES (rec.id, ord.id, item_id, uid);
  ELSE
    INSERT INTO public.cart_items (cart_id, kind, planned_ops, note, created_by)
    VALUES (cart.id, 'yeni_imalat', COALESCE(_planned_ops,'{}'),
            'Silindir değişimi: yeni imalat ihtiyacı.', uid)
    RETURNING id INTO item_id;
  END IF;

  SELECT COALESCE(max(sequence_no),0) + 1 INTO seq FROM public.team_members WHERE team_id = m.team_id;

  INSERT INTO public.team_members (team_id, cart_item_id, kind, receipt_id, planned_ops,
                                   sequence_no, added_by, replaces_member_id)
  VALUES (m.team_id, item_id,
          CASE WHEN _replacement_receipt_id IS NULL THEN 'yeni_imalat'::public.cart_item_kind
               ELSE 'mevcut'::public.cart_item_kind END,
          _replacement_receipt_id, COALESCE(_planned_ops,'{}'), seq, uid, m.id)
  RETURNING id INTO new_member;

  UPDATE public.team_members SET replaced_by_member_id = new_member WHERE id = m.id;

  SELECT count(*) FILTER (WHERE proof_ready_at IS NOT NULL AND receipt_id IS NOT NULL),
         count(*)
    INTO ready, total
    FROM public.team_members WHERE team_id = m.team_id AND is_active;
  IF ready < total THEN
    UPDATE public.teams SET proof_queued_at = NULL WHERE id = m.team_id;
  END IF;

  IF _issue_id IS NOT NULL THEN
    SELECT * INTO iss FROM public.quality_issues WHERE id = _issue_id FOR UPDATE;
    IF iss.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Kalite kaydı yok.'; END IF;
    IF iss.decision IS DISTINCT FROM 'silindir_degisimi' THEN
      RAISE EXCEPTION 'GECERSIZ: Önce "silindir değiştirme" kararı verilmelidir.';
    END IF;
    UPDATE public.quality_issues SET resolved_at = COALESCE(resolved_at, now()) WHERE id = _issue_id;
  END IF;

  PERFORM public.write_audit('team.member_replaced', 'team_members', m.id::text,
    jsonb_build_object('receipt_id', m.receipt_id, 'stage_no', m.stage_no,
                       'sequence_no', m.sequence_no),
    jsonb_build_object('replaced_by_member_id', new_member,
      'new_receipt_id', _replacement_receipt_id, 'old_lifecycle', _old_lifecycle,
      'issue_id', _issue_id, 'ready', ready, 'active_members', total), btrim(_reason));
  PERFORM public.command_finish(ikey, new_member::text);
  RETURN jsonb_build_object('old_member_id', m.id, 'member_id', new_member,
    'ready', ready, 'active_members', total, 'replayed', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.team_replace_member(uuid, text, uuid, public.planned_op[],
  public.cyl_lifecycle, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.team_replace_member(uuid, text, uuid, public.planned_op[],
  public.cyl_lifecycle, uuid, text) TO authenticated, service_role;
