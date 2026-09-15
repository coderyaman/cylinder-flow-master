-- Sıradaki iş, panoda verilen kuyruk sırasını (queue_rank) esas alır.
CREATE OR REPLACE FUNCTION public.op_start(_step_id uuid, _machine_id uuid, _qr_code text DEFAULT NULL::text, _skip_queue_reason text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid uuid; cmd record; step public.route_steps; plan public.route_plans;
        m public.team_members; rec public.cylinder_receipts; mach public.machines;
        st public.stations; asset public.graphic_assets; ord_id uuid;
        first_step uuid; op_id uuid;
BEGIN
  uid := public.assert_permission('operation.start');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'op_start',
    jsonb_build_object('step_id', _step_id, 'machine_id', _machine_id,
      'qr', upper(btrim(COALESCE(_qr_code,''))),
      'skip_reason', NULLIF(btrim(COALESCE(_skip_queue_reason,'')),'')));
  IF NOT cmd.is_new THEN
    RETURN jsonb_build_object('operation_id', cmd.prior, 'replayed', true);
  END IF;

  SELECT * INTO step FROM public.route_steps WHERE id = _step_id FOR UPDATE;
  IF step.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Rota adımı yok.'; END IF;
  IF step.status <> 'kuyrukta' THEN
    RAISE EXCEPTION 'GECERSIZ: Bu adım kuyrukta değil (%).', step.status;
  END IF;

  PERFORM public.assert_station_allowed(uid, step.station_id);

  SELECT * INTO plan FROM public.route_plans WHERE id = step.plan_id;
  IF plan.status <> 'yururlukte' THEN
    RAISE EXCEPTION 'GECERSIZ: Rota planı yürürlükte değil.';
  END IF;

  SELECT * INTO m FROM public.team_members WHERE id = plan.team_member_id FOR UPDATE;
  IF NOT m.is_active THEN RAISE EXCEPTION 'GECERSIZ: Üye takımdan çıkarılmış.'; END IF;
  IF m.released_at IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Üye üretime alınmamış.'; END IF;

  IF EXISTS (SELECT 1 FROM public.operations
              WHERE team_member_id = m.id AND status = 'bloke' AND block_resolved_at IS NULL) THEN
    RAISE EXCEPTION 'BLOKE: Bu silindirde açık bir bloke kaydı var.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.operations WHERE route_step_id = _step_id
              AND status <> 'bloke') THEN
    RAISE EXCEPTION 'GECERSIZ: Bu operasyon zaten başlatılmış.';
  END IF;

  IF m.receipt_id IS NOT NULL THEN
    SELECT * INTO rec FROM public.cylinder_receipts WHERE id = m.receipt_id;
    IF upper(btrim(COALESCE(_qr_code,''))) <> rec.cyl_code THEN
      RAISE EXCEPTION 'QR_UYUSMUYOR: Okutulan kod bu işin silindiriyle eşleşmiyor.';
    END IF;
  END IF;

  SELECT * INTO mach FROM public.machines WHERE id = _machine_id FOR UPDATE;
  IF mach.id IS NULL OR NOT mach.is_active THEN
    RAISE EXCEPTION 'GECERSIZ: Makine bulunamadı veya pasif.';
  END IF;
  IF mach.station_id <> step.station_id THEN
    RAISE EXCEPTION 'GECERSIZ: Makine bu istasyona ait değil.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.operations
              WHERE machine_id = _machine_id
                AND (status = 'devam' OR (status = 'bloke' AND machine_held))) THEN
    RAISE EXCEPTION 'MESGUL: Makinede devam eden veya makineden çıkarılmamış bir iş var.';
  END IF;

  SELECT * INTO st FROM public.stations WHERE id = step.station_id;
  IF st.code = 'GRAVUR' THEN
    IF m.receipt_id IS NULL THEN
      RAISE EXCEPTION 'GECERSIZ: Gravür yalnızca imal edilmiş fiziksel silindirde başlatılır.';
    END IF;
    IF m.stage_no IS NULL THEN
      RAISE EXCEPTION 'GECERSIZ: Kademe atanmadan Gravür başlatılamaz.';
    END IF;
    SELECT t.order_id INTO ord_id FROM public.teams t WHERE t.id = m.team_id;
    SELECT * INTO asset FROM public.graphic_assets
     WHERE order_id = ord_id AND is_current ORDER BY revision_no DESC LIMIT 1;
    IF asset.id IS NULL THEN
      RAISE EXCEPTION 'GECERSIZ: Erişilebilir grafik PDF olmadan Gravür başlatılamaz.';
    END IF;
  END IF;

  SELECT rs.id INTO first_step FROM public.route_steps rs
    JOIN public.route_plans rp ON rp.id = rs.plan_id
   WHERE rs.station_id = step.station_id AND rs.status = 'kuyrukta'
     AND rp.status = 'yururlukte'
   ORDER BY COALESCE(rs.queue_rank, 1000000), rs.queued_at LIMIT 1;
  IF first_step IS DISTINCT FROM _step_id
     AND NULLIF(btrim(COALESCE(_skip_queue_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'SIRA_ATLAMA: Sıradaki iş yerine bu işi almak için kısa gerekçe gerekir.';
  END IF;

  INSERT INTO public.operations (team_member_id, route_step_id, station_id, machine_id,
    op_label, round_no, started_by, skip_queue_reason, graphic_asset_id)
  VALUES (m.id, _step_id, step.station_id, _machine_id, step.op_label, step.round_no, uid,
    NULLIF(btrim(COALESCE(_skip_queue_reason,'')),''), asset.id)
  RETURNING id INTO op_id;

  PERFORM public.write_audit('operation.started', 'operations', op_id::text, NULL,
    jsonb_build_object('member_id', m.id, 'step_id', _step_id, 'station_id', step.station_id,
      'machine_id', _machine_id, 'op_label', step.op_label,
      'graphic_asset_id', asset.id), _skip_queue_reason);
  PERFORM public.command_finish(_idempotency_key, op_id::text);
  RETURN jsonb_build_object('operation_id', op_id, 'replayed', false);
END;
$function$;