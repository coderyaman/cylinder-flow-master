CREATE OR REPLACE FUNCTION public.tr_day(_ts timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT (_ts AT TIME ZONE 'Europe/Istanbul')::date;
$fn$;

CREATE OR REPLACE FUNCTION public.tr_start(_d date)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT (_d::timestamp AT TIME ZONE 'Europe/Istanbul');
$fn$;

GRANT EXECUTE ON FUNCTION public.tr_day(timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tr_start(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dash_production()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  today date := public.tr_day(now());
  week_start date;
  month_start date;
  res jsonb;
BEGIN
  IF NOT public.can_read_orders() THEN
    RAISE EXCEPTION 'YETKISIZ: Dashboard icin yetkiniz yok.';
  END IF;
  week_start := today - ((EXTRACT(ISODOW FROM today)::int) - 1);
  month_start := date_trunc('month', today)::date;

  WITH open_orders AS (
    SELECT o.* FROM public.orders o
     WHERE o.closure_status = 'acik' AND o.shipped_at IS NULL
  ),
  live_members AS (
    SELECT m.id, m.receipt_id, m.kind, m.stage_no, tm.id AS team_id, tm.team_code,
           tm.blocked_at, oo.id AS order_id, oo.work_order_no, oo.name AS order_name,
           oo.due_on, oo.priority, cu.name AS customer,
           EXISTS (SELECT 1 FROM public.route_plans rp
                    WHERE rp.team_member_id = m.id AND rp.status = 'yururlukte') AS released
      FROM public.team_members m
      JOIN public.teams tm ON tm.id = m.team_id
      JOIN open_orders oo ON oo.id = tm.order_id
      JOIN public.customers cu ON cu.id = oo.customer_id
     WHERE m.is_active
  ),
  blocked_members AS (
    SELECT DISTINCT lm.id
      FROM live_members lm
      LEFT JOIN public.operations op ON op.team_member_id = lm.id AND op.status = 'bloke'
      LEFT JOIN public.quality_issues q ON q.team_member_id = lm.id
             AND q.status IN ('acik','bilgi_bekleniyor')
     WHERE lm.receipt_id IS NOT NULL
       AND (op.id IS NOT NULL OR q.id IS NOT NULL OR lm.blocked_at IS NOT NULL)
  ),
  done_ops AS (
    SELECT op.id, op.finished_at, op.station_id, op.machine_id, op.team_member_id,
           m.receipt_id, op.started_at
      FROM public.operations op
      JOIN public.team_members m ON m.id = op.team_member_id
     WHERE op.status = 'tamamlandi' AND op.finished_at IS NOT NULL
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'today', today,
    'kpi', jsonb_build_object(
      'active_orders', (SELECT count(*) FROM open_orders),
      'wip_cylinders', (SELECT count(*) FROM live_members WHERE receipt_id IS NOT NULL AND released),
      'planned_manufacture', (SELECT count(*) FROM live_members WHERE receipt_id IS NULL),
      'not_released', (SELECT count(*) FROM live_members WHERE receipt_id IS NOT NULL AND NOT released),
      'ops_today', (SELECT count(*) FROM done_ops WHERE public.tr_day(finished_at) = today),
      'blocked_cylinders', (SELECT count(*) FROM blocked_members),
      'overdue_orders', (SELECT count(*) FROM open_orders WHERE due_on < today),
      'due_today_orders', (SELECT count(*) FROM open_orders WHERE due_on = today),
      'received_today', (SELECT count(*) FROM public.cylinder_receipts
                          WHERE status = 'kabul' AND received_on = today),
      'cyl_today', (SELECT count(DISTINCT receipt_id) FROM done_ops
                     WHERE receipt_id IS NOT NULL AND public.tr_day(finished_at) = today),
      'cyl_week', (SELECT count(DISTINCT receipt_id) FROM done_ops
                    WHERE receipt_id IS NOT NULL AND public.tr_day(finished_at) >= week_start),
      'cyl_month', (SELECT count(DISTINCT receipt_id) FROM done_ops
                     WHERE receipt_id IS NOT NULL AND public.tr_day(finished_at) >= month_start),
      'machines_active', (SELECT count(*) FROM public.machines WHERE is_active),
      'machines_busy', (SELECT count(DISTINCT op.machine_id) FROM public.operations op
                         WHERE op.status IN ('devam','bloke')),
      'open_issues', (SELECT count(*) FROM public.quality_issues
                       WHERE status IN ('acik','bilgi_bekleniyor'))
    ),
    'stations', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'sort_order')
        FROM (
          SELECT jsonb_build_object(
            'station_id', s.id, 'code', s.code, 'name', s.name,
            'sort_order', lpad(s.sort_order::text, 4, '0'),
            'in_progress', (SELECT count(*) FROM public.operations op
                             JOIN live_members lm2 ON lm2.id = op.team_member_id
                            WHERE op.station_id = s.id AND op.status = 'devam'),
            'blocked', (SELECT count(*) FROM public.operations op
                         JOIN live_members lm2 ON lm2.id = op.team_member_id
                        WHERE op.station_id = s.id AND op.status = 'bloke'),
            'queued', (SELECT count(*) FROM public.route_steps rs
                        JOIN public.route_plans rp ON rp.id = rs.plan_id AND rp.status = 'yururlukte'
                        JOIN live_members lm3 ON lm3.id = rp.team_member_id
                       WHERE rs.station_id = s.id AND rs.status = 'kuyrukta'
                         AND NOT EXISTS (SELECT 1 FROM public.operations o2
                                          WHERE o2.route_step_id = rs.id
                                            AND o2.status IN ('devam','bloke'))),
            'avg_queue_min', (SELECT round(avg(EXTRACT(EPOCH FROM (now() - rs.queued_at))/60))
                               FROM public.route_steps rs
                               JOIN public.route_plans rp ON rp.id = rs.plan_id AND rp.status = 'yururlukte'
                               JOIN live_members lm4 ON lm4.id = rp.team_member_id
                              WHERE rs.station_id = s.id AND rs.status = 'kuyrukta'
                                AND rs.queued_at IS NOT NULL),
            'avg_op_min_7d', (SELECT round(avg(EXTRACT(EPOCH FROM (d.finished_at - d.started_at))/60))
                               FROM done_ops d
                              WHERE d.station_id = s.id
                                AND public.tr_day(d.finished_at) >= today - 6),
            'ops_7d', (SELECT count(*) FROM done_ops d
                        WHERE d.station_id = s.id AND public.tr_day(d.finished_at) >= today - 6)
          ) AS x
          FROM public.stations s WHERE s.is_active
        ) q
    ), '[]'::jsonb),
    'waiting', COALESCE((
      SELECT jsonb_agg(w ORDER BY w->>'queued_at')
        FROM (
          SELECT jsonb_build_object(
            'step_id', rs.id, 'station', s.name, 'station_code', s.code,
            'op_label', rs.op_label, 'queued_at', rs.queued_at,
            'order_id', lm.order_id, 'customer', lm.customer,
            'work_order_no', lm.work_order_no, 'order_name', lm.order_name,
            'cyl_code', c.cyl_code, 'stage_no', lm.stage_no,
            'team_code', lm.team_code, 'due_on', lm.due_on, 'priority', lm.priority
          ) AS w
          FROM public.route_steps rs
          JOIN public.route_plans rp ON rp.id = rs.plan_id AND rp.status = 'yururlukte'
          JOIN live_members lm ON lm.id = rp.team_member_id
          JOIN public.stations s ON s.id = rs.station_id
          LEFT JOIN public.cylinder_receipts c ON c.id = lm.receipt_id
         WHERE rs.status = 'kuyrukta'
           AND NOT EXISTS (SELECT 1 FROM public.operations o2
                            WHERE o2.route_step_id = rs.id AND o2.status IN ('devam','bloke'))
        ) q
    ), '[]'::jsonb),
    'deadlines', COALESCE((
      SELECT jsonb_agg(d ORDER BY d->>'due_on')
        FROM (
          SELECT jsonb_build_object(
            'order_id', oo.id, 'customer', cu.name, 'work_order_no', oo.work_order_no,
            'order_name', oo.name, 'quantity', oo.quantity, 'due_on', oo.due_on,
            'priority', oo.priority,
            'bucket', CASE WHEN oo.due_on < today THEN 'gecikti'
                           WHEN oo.due_on = today THEN 'bugun'
                           WHEN oo.due_on <= today + 3 THEN 'yaklasan'
                           ELSE 'ileri' END,
            'active_members', (SELECT count(*) FROM live_members lm WHERE lm.order_id = oo.id),
            'blocked_members', (SELECT count(*) FROM live_members lm
                                 JOIN blocked_members bm ON bm.id = lm.id
                                WHERE lm.order_id = oo.id)
          ) AS d
          FROM open_orders oo JOIN public.customers cu ON cu.id = oo.customer_id
        ) q
    ), '[]'::jsonb),
    'quality', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'requested_at')
        FROM (
          SELECT jsonb_build_object(
            'issue_id', q.id, 'status', q.status, 'severity', q.severity,
            'category', dc.label, 'description', q.description,
            'responsibility', q.responsibility, 'billable', q.billable,
            'detected_station', s.name, 'requested_at', q.requested_at,
            'proof_run_id', q.proof_run_id,
            'cyl_code', c.cyl_code, 'order_id', lm.order_id,
            'customer', lm.customer, 'work_order_no', lm.work_order_no,
            'order_name', lm.order_name, 'team_code', lm.team_code
          ) AS x
          FROM public.quality_issues q
          JOIN live_members lm ON lm.id = q.team_member_id
          JOIN public.stations s ON s.id = q.detected_station_id
          LEFT JOIN public.defect_categories dc ON dc.code = q.category_code
          LEFT JOIN public.cylinder_receipts c ON c.id = lm.receipt_id
         WHERE q.status IN ('acik','bilgi_bekleniyor')
        ) q2
    ), '[]'::jsonb),
    'team_waiters', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'team_code')
        FROM (
          SELECT jsonb_build_object(
            'team_id', lm.team_id, 'team_code', lm.team_code,
            'order_id', lm.order_id, 'customer', lm.customer,
            'work_order_no', lm.work_order_no, 'order_name', lm.order_name,
            'due_on', lm.due_on, 'stage_no', lm.stage_no,
            'cyl_code', c.cyl_code, 'member_kind', lm.kind,
            'reason', CASE
              WHEN lm.receipt_id IS NULL THEN 'Planlanan imalat: fiziksel silindir yok'
              WHEN NOT lm.released THEN 'Uretime alinmadi'
              WHEN lm.blocked_at IS NOT NULL THEN 'Takim bloke'
              WHEN EXISTS (SELECT 1 FROM public.quality_issues q
                            WHERE q.team_member_id = lm.id
                              AND q.status IN ('acik','bilgi_bekleniyor'))
                THEN 'Kalite karari bekliyor'
              WHEN EXISTS (SELECT 1 FROM public.operations op
                            WHERE op.team_member_id = lm.id AND op.status = 'bloke')
                THEN 'Operasyon bloke'
              ELSE 'Uretim adimlari tamamlanmadi' END,
            'next_step', (SELECT rs.op_label || ' — ' || s2.name
                            FROM public.route_steps rs
                            JOIN public.route_plans rp ON rp.id = rs.plan_id AND rp.status = 'yururlukte'
                            JOIN public.stations s2 ON s2.id = rs.station_id
                           WHERE rp.team_member_id = lm.id AND rs.status IN ('kuyrukta','planlandi')
                           ORDER BY rs.seq LIMIT 1),
            'issue_id', (SELECT q.id FROM public.quality_issues q
                          WHERE q.team_member_id = lm.id
                            AND q.status IN ('acik','bilgi_bekleniyor')
                          ORDER BY q.requested_at LIMIT 1)
          ) AS x
          FROM live_members lm
          LEFT JOIN public.cylinder_receipts c ON c.id = lm.receipt_id
         WHERE lm.id NOT IN (SELECT tm2.id FROM public.team_members tm2
                              WHERE tm2.proof_ready_at IS NOT NULL)
        ) q3
    ), '[]'::jsonb),
    'machines', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'name')
        FROM (
          SELECT jsonb_build_object(
            'machine_id', mc.id, 'name', mc.name, 'code', mc.code,
            'station', s.name, 'is_active', mc.is_active,
            'busy', EXISTS (SELECT 1 FROM public.operations op
                             WHERE op.machine_id = mc.id AND op.status IN ('devam','bloke')),
            'ops_today', (SELECT count(*) FROM done_ops d
                           WHERE d.machine_id = mc.id AND public.tr_day(d.finished_at) = today),
            'minutes_today', (SELECT COALESCE(round(sum(EXTRACT(EPOCH FROM (d.finished_at - d.started_at))/60)), 0)
                               FROM done_ops d
                              WHERE d.machine_id = mc.id AND public.tr_day(d.finished_at) = today),
            'ops_week', (SELECT count(*) FROM done_ops d
                          WHERE d.machine_id = mc.id AND public.tr_day(d.finished_at) >= week_start),
            'minutes_week', (SELECT COALESCE(round(sum(EXTRACT(EPOCH FROM (d.finished_at - d.started_at))/60)), 0)
                              FROM done_ops d
                             WHERE d.machine_id = mc.id AND public.tr_day(d.finished_at) >= week_start)
          ) AS x
          FROM public.machines mc JOIN public.stations s ON s.id = mc.station_id
         WHERE mc.is_active
        ) q4
    ), '[]'::jsonb)
  ) INTO res;

  RETURN res;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dash_production() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dash_business(_from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  t0 timestamptz;
  t1 timestamptz;
  res jsonb;
  bill jsonb := jsonb_build_object('faturalandirilabilir', 0, 'faturalandirilmayacak', 0, 'karar_bekliyor', 0);
  o record;
  it jsonb;
BEGIN
  IF NOT public.can_read_orders() THEN
    RAISE EXCEPTION 'YETKISIZ: Dashboard icin yetkiniz yok.';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RAISE EXCEPTION 'GECERSIZ: Tarih araligi hatali.';
  END IF;
  t0 := public.tr_start(_from);
  t1 := public.tr_start(_to + 1);

  FOR o IN
    SELECT DISTINCT ap.order_id
      FROM public.accounting_packages ap
      JOIN public.orders ord ON ord.id = ap.order_id
     WHERE (ord.shipped_at >= t0 AND ord.shipped_at < t1)
        OR (ord.cancelled_at >= t0 AND ord.cancelled_at < t1)
  LOOP
    FOR it IN SELECT jsonb_array_elements(public.accounting_items(o.order_id)) LOOP
      bill := jsonb_set(bill, ARRAY[it->>'billing'],
        to_jsonb(COALESCE((bill->>(it->>'billing'))::int, 0) + 1));
    END LOOP;
  END LOOP;

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