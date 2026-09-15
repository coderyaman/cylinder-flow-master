CREATE OR REPLACE FUNCTION public.dash_business(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  t0 timestamptz;
  t1 timestamptz;
  res jsonb;
  bill jsonb := jsonb_build_object('faturalandirilabilir', 0, 'faturalandirilmayacak', 0, 'karar_bekliyor', 0);
BEGIN
  IF NOT public.can_read_orders() THEN
    RAISE EXCEPTION 'YETKISIZ: Dashboard icin yetkiniz yok.';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RAISE EXCEPTION 'GECERSIZ: Tarih araligi hatali.';
  END IF;
  t0 := public.tr_start(_from);
  t1 := public.tr_start(_to + 1);

  bill := public.dash_business_billing(t0, t1);

  WITH period_ops AS (
    SELECT op.id, op.finished_at, op.started_at, op.station_id, op.machine_id,
           op.performed_works, op.bakir_works, op.round_no,
           m.receipt_id, m.id AS member_id, tm.order_id, rp.rework_round, rp.quality_issue_id
      FROM public.operations op
      JOIN public.team_members m ON m.id = op.team_member_id
      JOIN public.teams tm ON tm.id = m.team_id
      JOIN public.route_steps rs ON rs.id = op.route_step_id
      JOIN public.route_plans rp ON rp.id = rs.plan_id
     WHERE op.status = 'tamamlandi' AND op.finished_at >= t0 AND op.finished_at < t1
  ),
  period_proof AS (
    SELECT pr.id, pr.team_id, pr.result, pr.finished_at,
           (SELECT count(*) FROM public.proof_run_members prm WHERE prm.run_id = pr.id) AS member_count
      FROM public.proof_runs pr
     WHERE pr.status = 'tamamlandi' AND pr.finished_at >= t0 AND pr.finished_at < t1
  ),
  period_ship AS (
    SELECT sh.id, sh.order_id, sh.team_id, sh.shipped_at,
           (SELECT count(*) FROM public.shipment_items si WHERE si.shipment_id = sh.id) AS items
      FROM public.shipments sh
     WHERE sh.shipped_at >= t0 AND sh.shipped_at < t1
  ),
  rework_events AS (
    SELECT rp.id, rp.created_at, q.responsibility
      FROM public.route_plans rp
      JOIN public.quality_issues q ON q.id = rp.quality_issue_id
     WHERE rp.quality_issue_id IS NOT NULL
       AND rp.created_at >= t0 AND rp.created_at < t1
  )
  SELECT jsonb_build_object(
    'from', _from, 'to', _to, 'generated_at', now(),
    'totals', jsonb_build_object(
      'completed_orders', (SELECT count(DISTINCT tm.order_id) FROM public.teams tm
                            WHERE tm.shipment_ready_at >= t0 AND tm.shipment_ready_at < t1),
      'shipped_orders', (SELECT count(DISTINCT order_id) FROM period_ship),
      'shipped_teams', (SELECT count(*) FROM period_ship),
      'shipped_cylinders', (SELECT COALESCE(sum(items), 0) FROM period_ship),
      'unique_cylinders', (SELECT count(DISTINCT receipt_id) FROM period_ops WHERE receipt_id IS NOT NULL),
      'completed_operations', (SELECT count(*) FROM period_ops),
      'proof_runs', (SELECT count(*) FROM period_proof),
      'proof_cylinders', (SELECT COALESCE(sum(member_count), 0) FROM period_proof),
      'work_items', (SELECT COALESCE(sum(GREATEST(
                        COALESCE(array_length(performed_works, 1), 0)
                      + COALESCE(array_length(bakir_works, 1), 0), 1)), 0) FROM period_ops),
      'rework_events_internal', (SELECT count(*) FROM rework_events WHERE responsibility = 'ic_hata'),
      'rework_events_customer', (SELECT count(*) FROM rework_events WHERE responsibility = 'musteri_revizyonu'),
      'rework_events_unknown', (SELECT count(*) FROM rework_events WHERE responsibility = 'bilinmiyor'),
      'rework_operations', (SELECT count(*) FROM period_ops WHERE COALESCE(rework_round, 1) > 1),
      'on_time_shipments', (SELECT count(*) FROM period_ship ps
                             JOIN public.orders ord ON ord.id = ps.order_id
                            WHERE public.tr_day(ps.shipped_at) <= ord.due_on)
    ),
    'billing', bill,
    'accounting', jsonb_build_object(
      'bekliyor', (SELECT count(*) FROM public.accounting_packages WHERE status = 'bekliyor' AND NOT needs_review),
      'islendi', (SELECT count(*) FROM public.accounting_packages WHERE status = 'islendi' AND NOT needs_review),
      'needs_review', (SELECT count(*) FROM public.accounting_packages WHERE needs_review)
    ),
    'stations', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'sort')
        FROM (
          SELECT jsonb_build_object(
            'code', s.code, 'name', s.name, 'sort', lpad(s.sort_order::text, 4, '0'),
            'operations', (SELECT count(*) FROM period_ops p WHERE p.station_id = s.id),
            'minutes', (SELECT COALESCE(round(sum(EXTRACT(EPOCH FROM (p.finished_at - p.started_at))/60)), 0)
                          FROM period_ops p WHERE p.station_id = s.id)
          ) AS x FROM public.stations s WHERE s.is_active
        ) q
    ), '[]'::jsonb),
    'customers', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'customer')
        FROM (
          SELECT jsonb_build_object(
            'customer', cu.name, 'customer_id', cu.id,
            'orders', count(DISTINCT p.order_id),
            'cylinders', count(DISTINCT p.receipt_id),
            'operations', count(p.id),
            'work_items', COALESCE(sum(GREATEST(
                COALESCE(array_length(p.performed_works, 1), 0)
              + COALESCE(array_length(p.bakir_works, 1), 0), 1)), 0),
            'rework_operations', count(*) FILTER (WHERE COALESCE(p.rework_round, 1) > 1),
            'shipped_teams', (SELECT count(*) FROM period_ship ps
                               JOIN public.orders o2 ON o2.id = ps.order_id
                              WHERE o2.customer_id = cu.id),
            'shipped_cylinders', (SELECT COALESCE(sum(ps.items), 0) FROM period_ship ps
                                   JOIN public.orders o3 ON o3.id = ps.order_id
                                  WHERE o3.customer_id = cu.id)
          ) AS x
          FROM period_ops p
          JOIN public.orders ord ON ord.id = p.order_id
          JOIN public.customers cu ON cu.id = ord.customer_id
          GROUP BY cu.id, cu.name
        ) q
    ), '[]'::jsonb),
    'shipments', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'shipped_at' DESC)
        FROM (
          SELECT jsonb_build_object(
            'shipment_id', ps.id, 'order_id', ps.order_id, 'shipped_at', ps.shipped_at,
            'cylinders', ps.items, 'customer', cu.name,
            'work_order_no', ord.work_order_no, 'order_name', ord.name,
            'due_on', ord.due_on,
            'on_time', (public.tr_day(ps.shipped_at) <= ord.due_on)
          ) AS x
          FROM period_ship ps
          JOIN public.orders ord ON ord.id = ps.order_id
          JOIN public.customers cu ON cu.id = ord.customer_id
        ) q
    ), '[]'::jsonb)
  ) INTO res;

  RETURN res;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dash_business(date, date) TO authenticated, service_role;
