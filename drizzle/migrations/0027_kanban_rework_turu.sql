-- Pano kartlarina rework turu bilgisi eklenir (rework filtresi icin).
CREATE OR REPLACE FUNCTION public.kanban_board()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE cols jsonb := '[]'::jsonb; s record; r record;
        inprog jsonb; queued jsonb; blocked jsonb;
        teams_running jsonb := '[]'::jsonb; teams_queue jsonb := '[]'::jsonb;
        teams_prep jsonb := '[]'::jsonb; teams_blocked jsonb := '[]'::jsonb;
        teams_ship jsonb := '[]'::jsonb; g jsonb; t record; card jsonb;
BEGIN
  IF NOT public.can_read_orders() THEN
    RAISE EXCEPTION 'YETKISIZ: Pano icin yetkiniz yok.';
  END IF;

  FOR s IN SELECT id, code, name, sort_order FROM public.stations
            WHERE is_active AND code <> 'PROVA' ORDER BY sort_order LOOP
    inprog := '[]'::jsonb; queued := '[]'::jsonb; blocked := '[]'::jsonb;

    FOR r IN
      SELECT o.id AS operation_id, o.status, o.started_at, o.op_label, o.note,
             o.machine_held, o.round_no, mc.name AS machine_name, pr.full_name AS operator_name,
             m.id AS member_id, m.stage_no, m.kind, m.planned_ops,
             c.cyl_code, tm.team_code, tm.blocked_at AS team_blocked_at,
             ord.id AS order_id, ord.work_order_no, ord.name AS order_name,
             ord.due_on, ord.priority, ord.critical_note, cu.name AS customer,
             (SELECT count(*) FROM public.operation_notes n
               WHERE n.team_member_id = m.id AND n.kind = 'uyari'
                 AND n.acknowledged_at IS NULL) AS warnings,
             (SELECT q.id FROM public.quality_issues q
               WHERE q.operation_id = o.id AND q.status IN ('acik','bilgi_bekleniyor')
               ORDER BY q.requested_at LIMIT 1) AS issue_id
        FROM public.operations o
        JOIN public.team_members m ON m.id = o.team_member_id
        JOIN public.teams tm ON tm.id = m.team_id
        JOIN public.orders ord ON ord.id = tm.order_id
        JOIN public.customers cu ON cu.id = ord.customer_id
        LEFT JOIN public.machines mc ON mc.id = o.machine_id
        LEFT JOIN public.profiles pr ON pr.id = o.started_by
        LEFT JOIN public.cylinder_receipts c ON c.id = m.receipt_id
       WHERE o.station_id = s.id AND o.status IN ('devam','bloke')
         AND ord.closure_status = 'acik' AND ord.shipped_at IS NULL
         AND m.is_active
       ORDER BY o.started_at
    LOOP
      card := jsonb_build_object(
        'kind', 'cylinder', 'member_id', r.member_id, 'operation_id', r.operation_id,
        'step_id', NULL, 'order_id', r.order_id, 'team_code', r.team_code,
        'customer', r.customer, 'work_order_no', r.work_order_no,
        'order_name', r.order_name, 'cyl_code', r.cyl_code,
        'member_kind', r.kind, 'stage_no', r.stage_no,
        'planned_ops', to_jsonb(r.planned_ops), 'due_on', r.due_on,
        'priority', r.priority, 'critical_note', r.critical_note,
        'since', r.started_at, 'op_label', r.op_label,
        'machine', r.machine_name, 'operator', r.operator_name,
        'warnings', r.warnings, 'note', r.note, 'issue_id', r.issue_id,
        'machine_held', r.machine_held,
        'rework_round', CASE WHEN r.round_no > 1 THEN r.round_no ELSE NULL END,
        'hold', CASE WHEN r.team_blocked_at IS NOT NULL THEN 'yonetim'
                     WHEN r.issue_id IS NOT NULL THEN 'karar'
                     WHEN r.status = 'bloke' THEN 'bloke' ELSE NULL END);
      IF r.status = 'devam' THEN inprog := inprog || card;
      ELSE blocked := blocked || card; END IF;
    END LOOP;

    FOR r IN
      SELECT rs.id AS step_id, rs.op_label, rs.queued_at, rs.queue_rank, rp.rework_round,
             m.id AS member_id, m.stage_no, m.kind, m.planned_ops,
             c.cyl_code, tm.team_code, tm.blocked_at AS team_blocked_at,
             ord.id AS order_id, ord.work_order_no, ord.name AS order_name,
             ord.due_on, ord.priority, ord.critical_note, cu.name AS customer,
             (SELECT count(*) FROM public.operation_notes n
               WHERE n.team_member_id = m.id AND n.kind = 'uyari'
                 AND n.acknowledged_at IS NULL) AS warnings
        FROM public.route_steps rs
        JOIN public.route_plans rp ON rp.id = rs.plan_id AND rp.status = 'yururlukte'
        JOIN public.team_members m ON m.id = rp.team_member_id
        JOIN public.teams tm ON tm.id = m.team_id
        JOIN public.orders ord ON ord.id = tm.order_id
        JOIN public.customers cu ON cu.id = ord.customer_id
        LEFT JOIN public.cylinder_receipts c ON c.id = m.receipt_id
       WHERE rs.station_id = s.id AND rs.status = 'kuyrukta'
         AND ord.closure_status = 'acik' AND ord.shipped_at IS NULL
         AND m.is_active
         AND NOT EXISTS (SELECT 1 FROM public.operations o2
                          WHERE o2.route_step_id = rs.id AND o2.status IN ('devam','bloke'))
       ORDER BY COALESCE(rs.queue_rank, 1000000), rs.queued_at
    LOOP
      queued := queued || jsonb_build_object(
        'kind', 'cylinder', 'member_id', r.member_id, 'operation_id', NULL,
        'step_id', r.step_id, 'order_id', r.order_id, 'team_code', r.team_code,
        'customer', r.customer, 'work_order_no', r.work_order_no,
        'order_name', r.order_name, 'cyl_code', r.cyl_code,
        'member_kind', r.kind, 'stage_no', r.stage_no,
        'planned_ops', to_jsonb(r.planned_ops), 'due_on', r.due_on,
        'priority', r.priority, 'critical_note', r.critical_note,
        'since', r.queued_at, 'op_label', r.op_label,
        'machine', NULL, 'operator', NULL, 'warnings', r.warnings,
        'note', NULL, 'issue_id', NULL, 'machine_held', false,
        'rework_round', r.rework_round,
        'hold', CASE WHEN r.team_blocked_at IS NOT NULL THEN 'yonetim' ELSE NULL END);
    END LOOP;

    cols := cols || jsonb_build_object('station_id', s.id, 'code', s.code,
      'name', s.name, 'sort_order', s.sort_order, 'team_column', false,
      'in_progress', inprog, 'queued', queued, 'blocked', blocked);
  END LOOP;

  FOR t IN
    SELECT tm.id, tm.team_code, ord.id AS order_id, ord.work_order_no,
           ord.name AS order_name, ord.due_on, ord.priority, ord.critical_note,
           cu.name AS customer
      FROM public.teams tm
      JOIN public.orders ord ON ord.id = tm.order_id
      JOIN public.customers cu ON cu.id = ord.customer_id
     WHERE ord.closure_status = 'acik' AND ord.shipped_at IS NULL
     ORDER BY ord.due_on NULLS LAST, tm.team_code
  LOOP
    g := public.proof_gate(t.id);
    card := jsonb_build_object(
      'kind', 'team', 'team_id', t.id, 'team_code', t.team_code,
      'order_id', t.order_id, 'customer', t.customer,
      'work_order_no', t.work_order_no, 'order_name', t.order_name,
      'due_on', t.due_on, 'priority', t.priority, 'critical_note', t.critical_note,
      'quantity', g->'quantity', 'active_members', g->'active_members',
      'ready_members', (SELECT count(*) FROM jsonb_array_elements(g->'members') x
                         WHERE x->>'proof_ready_at' IS NOT NULL),
      'blockers', g->'blockers', 'pending_decisions', g->'pending_decisions',
      'blocked_at', g->'blocked_at', 'blocked_reason', g->'blocked_reason',
      'ready', g->'ready', 'active_run_id', g->'active_run_id',
      'shipment_ready_at', g->'shipment_ready_at',
      'approval_valid', g->'approval_valid');

    IF (g->>'active_run_id') IS NOT NULL THEN
      SELECT jsonb_build_object('machine', mc.name, 'operator', pr.full_name,
               'started_at', pruns.started_at, 'round_no', pruns.round_no)
        INTO g
        FROM public.proof_runs pruns
        LEFT JOIN public.machines mc ON mc.id = pruns.machine_id
        LEFT JOIN public.profiles pr ON pr.id = pruns.started_by
       WHERE pruns.id = (card->>'active_run_id')::uuid;
      teams_running := teams_running || (card || COALESCE(g, '{}'::jsonb));
    ELSIF (card->>'shipment_ready_at') IS NOT NULL AND (card->>'approval_valid')::boolean THEN
      teams_ship := teams_ship || card;
    ELSIF (card->>'blocked_at') IS NOT NULL
       OR jsonb_array_length(card->'pending_decisions') > 0 THEN
      teams_blocked := teams_blocked || card;
    ELSIF (card->>'ready')::boolean THEN
      teams_queue := teams_queue || card;
    ELSE
      teams_prep := teams_prep || card;
    END IF;
  END LOOP;

  cols := cols || jsonb_build_object('station_id',
      (SELECT id FROM public.stations WHERE code = 'PROVA' LIMIT 1),
    'code', 'PROVA', 'name', 'Prova', 'sort_order', 9999, 'team_column', true,
    'in_progress', teams_running, 'queued', teams_queue,
    'blocked', teams_blocked, 'preparing', teams_prep, 'ready_to_ship', teams_ship);

  RETURN jsonb_build_object('generated_at', now(), 'columns', cols);
END;
$fn$;