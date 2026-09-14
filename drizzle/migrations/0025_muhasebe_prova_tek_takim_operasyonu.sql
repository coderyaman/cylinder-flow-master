-- Prova tek takım operasyonu olarak sayılır; eski CYL bazlı Prova kayıtları ticari kalem değildir.
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
       AND s.code <> 'PROVA'
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