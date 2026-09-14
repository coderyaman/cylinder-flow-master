-- Aşama 10: Muhasebe ve gerçekleşen işlerin ticari değerlendirmesi (PRD 15).
DO $mig$ BEGIN
  CREATE TYPE public.billing_class AS ENUM
    ('faturalandirilabilir','faturalandirilmayacak','karar_bekliyor');
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

CREATE TABLE IF NOT EXISTS public.billing_rules (
  station_code text PRIMARY KEY,
  label text NOT NULL,
  default_billing public.billing_class NOT NULL DEFAULT 'karar_bekliyor',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
GRANT SELECT ON public.billing_rules TO authenticated;
GRANT ALL ON public.billing_rules TO service_role;
ALTER TABLE public.billing_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "billing_rules_select" ON public.billing_rules;
CREATE POLICY "billing_rules_select" ON public.billing_rules FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  item_kind text NOT NULL,
  ref_id uuid NOT NULL,
  billing public.billing_class NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (item_kind, ref_id)
);
GRANT SELECT ON public.accounting_overrides TO authenticated;
GRANT ALL ON public.accounting_overrides TO service_role;
ALTER TABLE public.accounting_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "accounting_overrides_select" ON public.accounting_overrides;
CREATE POLICY "accounting_overrides_select" ON public.accounting_overrides FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));

CREATE TABLE IF NOT EXISTS public.accounting_processings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.accounting_packages(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  fingerprint text NOT NULL,
  item_count integer NOT NULL,
  snapshot jsonb NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  processed_by uuid REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS accounting_processings_pkg_idx
  ON public.accounting_processings(package_id);
GRANT SELECT ON public.accounting_processings TO authenticated;
GRANT ALL ON public.accounting_processings TO service_role;
ALTER TABLE public.accounting_processings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "accounting_processings_select" ON public.accounting_processings;
CREATE POLICY "accounting_processings_select" ON public.accounting_processings FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));

ALTER TABLE public.accounting_packages
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS last_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS accounting_packages_cancel_uniq
  ON public.accounting_packages(order_id) WHERE shipment_id IS NULL;

-- Gerçekleşen ticari kalemler: yalnızca tamamlanmış operasyonlar ve tamamlanmış Prova turları.
CREATE OR REPLACE FUNCTION public.accounting_items(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE items jsonb := '[]'::jsonb; fp text; pkg public.accounting_packages;
BEGIN
  IF NOT (public.has_permission(auth.uid(),'accounting.process')
       OR public.has_permission(auth.uid(),'billing.decide')
       OR public.has_permission(auth.uid(),'billing.override')
       OR public.caller_is_admin()) THEN
    RAISE EXCEPTION 'YETKISIZ: Muhasebe görünümü yetkiniz yok.';
  END IF;

  WITH ops AS (
    SELECT o.id, o.op_label, o.round_no, o.finished_at, o.result,
           o.performed_works, o.bakir_works,
           s.code AS station_code, s.name AS station_name,
           m.id AS member_id, m.stage_no, m.kind AS member_kind,
           c.cyl_code,
           rp.rework_round, rp.quality_issue_id,
           qi.responsibility, qi.billable, qi.category_code
      FROM public.operations o
      JOIN public.team_members m ON m.id = o.team_member_id
      JOIN public.teams t ON t.id = m.team_id
      JOIN public.stations s ON s.id = o.station_id
      LEFT JOIN public.cylinder_receipts c ON c.id = m.receipt_id
      LEFT JOIN public.route_steps rs ON rs.id = o.route_step_id
      LEFT JOIN public.route_plans rp ON rp.id = rs.plan_id
      LEFT JOIN public.quality_issues qi ON qi.id = rp.quality_issue_id
     WHERE t.order_id = _order_id
       AND o.status = 'tamamlandi'
       AND o.finished_at IS NOT NULL
  ), op_items AS (
    SELECT jsonb_build_object(
      'kind','operation', 'ref_id', ops.id,
      'label', ops.station_name || ' — ' || ops.op_label,
      'station_code', ops.station_code,
      'cyl_code', COALESCE(ops.cyl_code, 'Planlanan imalat'),
      'member_id', ops.member_id, 'stage_no', ops.stage_no,
      'member_kind', ops.member_kind,
      'round_no', ops.round_no,
      'rework_round', COALESCE(ops.rework_round, 1),
      'quality_issue_id', ops.quality_issue_id,
      'occurred_at', ops.finished_at,
      'result', ops.result,
      'works', COALESCE(
        (SELECT array_to_json(ops.performed_works)::jsonb), '[]'::jsonb),
      'bakir_works', COALESCE(
        (SELECT array_to_json(ops.bakir_works)::jsonb), '[]'::jsonb),
      'base_billing',
        CASE
          WHEN ov.billing IS NOT NULL THEN ov.billing::text
          WHEN ops.quality_issue_id IS NOT NULL AND ops.responsibility = 'ic_hata'
            THEN 'faturalandirilmayacak'
          WHEN ops.quality_issue_id IS NOT NULL AND ops.responsibility = 'musteri_revizyonu'
            THEN 'faturalandirilabilir'
          WHEN ops.quality_issue_id IS NOT NULL THEN 'karar_bekliyor'
          ELSE COALESCE(br.default_billing::text, 'karar_bekliyor')
        END,
      'billing',
        CASE
          WHEN ov.billing IS NOT NULL THEN ov.billing::text
          WHEN ops.quality_issue_id IS NOT NULL AND ops.responsibility = 'ic_hata'
            THEN 'faturalandirilmayacak'
          WHEN ops.quality_issue_id IS NOT NULL AND ops.responsibility = 'musteri_revizyonu'
            THEN 'faturalandirilabilir'
          WHEN ops.quality_issue_id IS NOT NULL THEN 'karar_bekliyor'
          ELSE COALESCE(br.default_billing::text, 'karar_bekliyor')
        END,
      'source',
        CASE
          WHEN ov.billing IS NOT NULL THEN 'istisna'
          WHEN ops.quality_issue_id IS NOT NULL AND ops.responsibility = 'ic_hata'
            THEN 'rework_ic_hata'
          WHEN ops.quality_issue_id IS NOT NULL AND ops.responsibility = 'musteri_revizyonu'
            THEN 'rework_musteri_revizyonu'
          WHEN ops.quality_issue_id IS NOT NULL THEN 'rework_belirsiz'
          WHEN br.default_billing IS NULL THEN 'tanimsiz'
          ELSE 'varsayilan'
        END,
      'reason', ov.reason
    ) AS item, ops.finished_at AS ts, ops.id AS rid
      FROM ops
      LEFT JOIN public.billing_rules br ON br.station_code = ops.station_code
      LEFT JOIN public.accounting_overrides ov
             ON ov.item_kind = 'operation' AND ov.ref_id = ops.id
  ), runs AS (
    SELECT pr.id, pr.round_no, pr.finished_at, pr.result, t.team_code
      FROM public.proof_runs pr
      JOIN public.teams t ON t.id = pr.team_id
     WHERE t.order_id = _order_id
       AND pr.status = 'tamamlandi'
       AND pr.finished_at IS NOT NULL
  ), run_items AS (
    SELECT jsonb_build_object(
      'kind','proof_run', 'ref_id', runs.id,
      'label','Prova (takım operasyonu) — Tur ' || runs.round_no,
      'station_code','PROVA',
      'cyl_code', runs.team_code,
      'member_id', NULL, 'stage_no', NULL, 'member_kind', NULL,
      'round_no', runs.round_no, 'rework_round', runs.round_no,
      'quality_issue_id', NULL,
      'occurred_at', runs.finished_at,
      'result', runs.result,
      'works','[]'::jsonb, 'bakir_works','[]'::jsonb,
      'base_billing', COALESCE(br.default_billing::text,'karar_bekliyor'),
      'billing', COALESCE(ov.billing::text, br.default_billing::text, 'karar_bekliyor'),
      'source', CASE WHEN ov.billing IS NOT NULL THEN 'istisna'
                     WHEN br.default_billing IS NULL THEN 'tanimsiz'
                     ELSE 'varsayilan' END,
      'reason', ov.reason
    ) AS item, runs.finished_at AS ts, runs.id AS rid
      FROM runs
      LEFT JOIN public.billing_rules br ON br.station_code = 'PROVA'
      LEFT JOIN public.accounting_overrides ov
             ON ov.item_kind = 'proof_run' AND ov.ref_id = runs.id
  ), allitems AS (
    SELECT item, ts, rid FROM op_items
    UNION ALL
    SELECT item, ts, rid FROM run_items
  )
  SELECT COALESCE(jsonb_agg(item ORDER BY ts), '[]'::jsonb),
         md5(COALESCE(string_agg(rid::text || ':' || (item->>'billing'), '|' ORDER BY rid::text), ''))
    INTO items, fp
    FROM allitems;

  SELECT * INTO pkg FROM public.accounting_packages WHERE order_id = _order_id
   ORDER BY created_at LIMIT 1;

  IF pkg.id IS NOT NULL AND pkg.status = 'islendi'
     AND pkg.last_fingerprint IS DISTINCT FROM fp AND NOT pkg.needs_review THEN
    UPDATE public.accounting_packages
       SET needs_review = true,
           review_reason = 'Ticari kalemler işlendikten sonra değişti.'
     WHERE id = pkg.id;
    pkg.needs_review := true;
    pkg.review_reason := 'Ticari kalemler işlendikten sonra değişti.';
  END IF;

  RETURN jsonb_build_object(
    'order_id', _order_id,
    'items', items,
    'fingerprint', fp,
    'package', CASE WHEN pkg.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', pkg.id, 'status', pkg.status, 'trigger', pkg.trigger,
      'needs_review', pkg.needs_review, 'review_reason', pkg.review_reason,
      'processed_at', pkg.processed_at, 'processed_by', pkg.processed_by,
      'last_fingerprint', pkg.last_fingerprint) END
  );
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.accounting_items(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.accounting_set_billing(
  _order_id uuid, _item_kind text, _ref_id uuid, _billing public.billing_class,
  _reason text, _idempotency_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid; cmd record; ov_id uuid; pkg public.accounting_packages;
BEGIN
  uid := public.assert_permission('billing.override');
  IF _item_kind NOT IN ('operation','proof_run') THEN
    RAISE EXCEPTION 'GECERSIZ: Bilinmeyen kalem türü.';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'GECERSIZ: Ticari istisna için gerekçe zorunludur.';
  END IF;
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'accounting_set_billing',
    jsonb_build_object('order_id', _order_id, 'kind', _item_kind, 'ref_id', _ref_id,
      'billing', _billing::text, 'reason', btrim(_reason)));
  IF NOT cmd.is_new THEN RETURN cmd.prior::uuid; END IF;

  INSERT INTO public.accounting_overrides (order_id, item_kind, ref_id, billing, reason, created_by)
  VALUES (_order_id, _item_kind, _ref_id, _billing, btrim(_reason), uid)
  ON CONFLICT (item_kind, ref_id) DO UPDATE
    SET billing = EXCLUDED.billing, reason = EXCLUDED.reason,
        created_by = EXCLUDED.created_by, created_at = now()
  RETURNING id INTO ov_id;

  SELECT * INTO pkg FROM public.accounting_packages WHERE order_id = _order_id
   ORDER BY created_at LIMIT 1;
  IF pkg.id IS NOT NULL AND pkg.status = 'islendi' THEN
    UPDATE public.accounting_packages
       SET needs_review = true,
           review_reason = 'Ticari karar işlendikten sonra değiştirildi.'
     WHERE id = pkg.id;
  END IF;

  PERFORM public.write_audit('accounting.billing_override','accounting_overrides', ov_id::text,
    NULL, jsonb_build_object('order_id', _order_id, 'kind', _item_kind, 'ref_id', _ref_id,
      'billing', _billing::text), btrim(_reason));
  PERFORM public.command_finish(_idempotency_key, ov_id::text);
  RETURN ov_id;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.accounting_set_billing(uuid, text, uuid, public.billing_class, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.accounting_process(
  _order_id uuid, _note text DEFAULT NULL, _idempotency_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid; cmd record; pkg public.accounting_packages; snap jsonb;
        fp text; cnt integer; pid uuid;
BEGIN
  uid := public.assert_permission('accounting.process');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'accounting_process',
    jsonb_build_object('order_id', _order_id));
  IF NOT cmd.is_new THEN RETURN cmd.prior::uuid; END IF;

  SELECT * INTO pkg FROM public.accounting_packages WHERE order_id = _order_id
   ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF pkg.id IS NULL THEN
    RAISE EXCEPTION 'BULUNAMADI: Bu sipariş için muhasebe kaydı yok.';
  END IF;

  snap := public.accounting_items(_order_id);
  fp := snap->>'fingerprint';
  cnt := jsonb_array_length(snap->'items');

  IF pkg.status = 'islendi' AND pkg.last_fingerprint IS NOT DISTINCT FROM fp THEN
    PERFORM public.command_finish(_idempotency_key, pkg.id::text);
    RETURN pkg.id;
  END IF;

  INSERT INTO public.accounting_processings
    (package_id, order_id, fingerprint, item_count, snapshot, processed_by)
  VALUES (pkg.id, _order_id, fp, cnt, snap->'items', uid)
  RETURNING id INTO pid;

  UPDATE public.accounting_packages
     SET status = 'islendi', processed_at = now(), processed_by = uid,
         last_fingerprint = fp, needs_review = false, review_reason = NULL
   WHERE id = pkg.id;

  PERFORM public.write_audit('accounting.processed','accounting_packages', pkg.id::text,
    jsonb_build_object('status', pkg.status::text),
    jsonb_build_object('status','islendi','fingerprint', fp,'item_count', cnt,
      'processing_id', pid), NULLIF(btrim(COALESCE(_note,'')),''));
  PERFORM public.command_finish(_idempotency_key, pkg.id::text);
  RETURN pkg.id;
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.accounting_process(uuid, text, text) TO authenticated, service_role;

-- Üretim görmüş iptaller ticari havuza girer; üretim görmemiş iptaller girmez.
CREATE OR REPLACE FUNCTION public.cancel_order(
  _order_id uuid, _row_version integer, _reason text, _idempotency_key text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE old_row public.orders; uid uuid; new_version integer; cmd record; has_prod boolean;
BEGIN
  uid := public.assert_permission('orders.cancel');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'cancel_order',
    jsonb_build_object('order_id', _order_id, 'row_version', _row_version, 'reason', btrim(COALESCE(_reason,''))));
  IF NOT cmd.is_new THEN RETURN cmd.prior::integer; END IF;

  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'GECERSIZ: İptal gerekçesi zorunludur.';
  END IF;
  SELECT * INTO old_row FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sipariş yok.'; END IF;
  IF old_row.closure_status = 'iptal' THEN
    RAISE EXCEPTION 'IPTAL_EDILMIS: Sipariş zaten iptal edilmiş.';
  END IF;
  PERFORM public.assert_can_write_order(old_row, uid);
  PERFORM public.assert_row_version(_row_version, old_row.row_version);

  UPDATE public.orders SET closure_status = 'iptal', cancel_reason = btrim(_reason),
    cancelled_at = now(), cancelled_by = uid, row_version = old_row.row_version + 1,
    updated_by = uid
  WHERE id = _order_id RETURNING row_version INTO new_version;

  SELECT EXISTS (
    SELECT 1 FROM public.operations o
      JOIN public.team_members m ON m.id = o.team_member_id
      JOIN public.teams t ON t.id = m.team_id
     WHERE t.order_id = _order_id AND o.status = 'tamamlandi'
  ) INTO has_prod;

  IF has_prod THEN
    INSERT INTO public.accounting_packages (order_id, shipment_id, trigger, status)
    VALUES (_order_id, NULL, 'iptal', 'bekliyor')
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM public.write_audit('order.cancelled', 'orders', _order_id::text,
    jsonb_build_object('closure_status', old_row.closure_status),
    jsonb_build_object('closure_status', 'iptal', 'accounting', has_prod), btrim(_reason));
  PERFORM public.command_finish(_idempotency_key, new_version::text);
  RETURN new_version;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, integer, text, text) TO authenticated, service_role;