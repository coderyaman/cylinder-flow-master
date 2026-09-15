-- Asama 11: Uretim Kanbani. Pano mevcut rota/kuyruk/operasyon kayitlarindan beslenir.
ALTER TABLE public.route_steps ADD COLUMN IF NOT EXISTS queue_rank integer;

CREATE OR REPLACE FUNCTION public.queue_reorder(_station_id uuid, _step_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE i integer; n integer := 0;
BEGIN
  PERFORM public.assert_permission('team.manage');
  FOR i IN 1..COALESCE(array_length(_step_ids, 1), 0) LOOP
    UPDATE public.route_steps SET queue_rank = i
     WHERE id = _step_ids[i] AND station_id = _station_id AND status = 'kuyrukta';
    IF FOUND THEN n := n + 1; END IF;
  END LOOP;
  PERFORM public.write_audit('queue.reordered', 'stations', _station_id::text, NULL,
    jsonb_build_object('step_ids', to_jsonb(_step_ids)), NULL);
  RETURN n;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.queue_reorder(uuid, uuid[]) TO authenticated, service_role;

-- Pano: istasyon sutunlari + Prova takim sutunu.
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
             o.machine_held, mc.name AS machine_name, pr.full_name AS operator_name,
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
        'hold', CASE WHEN r.team_blocked_at IS NOT NULL THEN 'yonetim'
                     WHEN r.issue_id IS NOT NULL THEN 'karar'
                     WHEN r.status = 'bloke' THEN 'bloke' ELSE NULL END);
      IF r.status = 'devam' THEN inprog := inprog || card;
      ELSE blocked := blocked || card; END IF;
    END LOOP;

    FOR r IN
      SELECT rs.id AS step_id, rs.op_label, rs.queued_at, rs.queue_rank,
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
        'hold', CASE WHEN r.team_blocked_at IS NOT NULL THEN 'yonetim' ELSE NULL END);
    END LOOP;

    cols := cols || jsonb_build_object('station_id', s.id, 'code', s.code,
      'name', s.name, 'sort_order', s.sort_order, 'team_column', false,
      'in_progress', inprog, 'queued', queued, 'blocked', blocked);
  END LOOP;

  -- Prova sutunu: takim karti.
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

GRANT EXECUTE ON FUNCTION public.kanban_board() TO authenticated, service_role;

-- Siparis gorunumu: guncel aktif uyelerin dagilimi + tarihsel uyeler.
CREATE OR REPLACE FUNCTION public.kanban_order_detail(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE ord public.orders; members jsonb := '[]'::jsonb; hist jsonb := '[]'::jsonb;
        r record; st jsonb; state text; loc text;
BEGIN
  IF NOT public.can_read_orders() THEN
    RAISE EXCEPTION 'YETKISIZ: Siparis gorunumu icin yetkiniz yok.';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id = _order_id;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Siparis yok.'; END IF;

  FOR r IN
    SELECT m.id, m.stage_no, m.kind, m.receipt_id, m.planned_ops, m.proof_ready_at,
           m.sequence_no, c.cyl_code, tm.team_code, tm.blocked_at,
           (SELECT count(*) FROM public.route_plans rp
             WHERE rp.team_member_id = m.id AND rp.status = 'yururlukte') AS plans,
           (SELECT jsonb_build_object('operation_id', o.id, 'station', s2.name,
                     'status', o.status, 'started_at', o.started_at,
                     'machine', mc.name, 'operator', pr.full_name, 'op_label', o.op_label)
              FROM public.operations o
              JOIN public.stations s2 ON s2.id = o.station_id
              LEFT JOIN public.machines mc ON mc.id = o.machine_id
              LEFT JOIN public.profiles pr ON pr.id = o.started_by
             WHERE o.team_member_id = m.id AND o.status IN ('devam','bloke')
             ORDER BY o.started_at LIMIT 1) AS open_op,
           (SELECT jsonb_build_object('step_id', rs.id, 'station', s3.name,
                     'status', rs.status, 'op_label', rs.op_label,
                     'queued_at', rs.queued_at)
              FROM public.route_steps rs
              JOIN public.route_plans rp ON rp.id = rs.plan_id AND rp.status = 'yururlukte'
              JOIN public.stations s3 ON s3.id = rs.station_id
             WHERE rp.team_member_id = m.id AND rs.status IN ('kuyrukta','planlandi')
             ORDER BY rs.seq LIMIT 1) AS next_step,
           (SELECT q.id FROM public.quality_issues q
             WHERE q.team_member_id = m.id AND q.status IN ('acik','bilgi_bekleniyor')
             ORDER BY q.requested_at LIMIT 1) AS issue_id
      FROM public.team_members m
      JOIN public.teams tm ON tm.id = m.team_id
      LEFT JOIN public.cylinder_receipts c ON c.id = m.receipt_id
     WHERE tm.order_id = _order_id AND m.is_active
     ORDER BY m.stage_no NULLS LAST, m.sequence_no
  LOOP
    IF r.open_op IS NOT NULL AND r.open_op->>'status' = 'devam' THEN
      state := 'islemde'; loc := r.open_op->>'station';
    ELSIF r.open_op IS NOT NULL THEN
      state := 'bloke'; loc := r.open_op->>'station';
    ELSIF r.receipt_id IS NULL THEN
      state := 'planlanan'; loc := NULL;
    ELSIF r.plans = 0 THEN
      state := 'uretime_alinmadi'; loc := NULL;
    ELSIF r.next_step IS NOT NULL THEN
      state := CASE WHEN r.next_step->>'status' = 'kuyrukta' THEN 'kuyrukta' ELSE 'planli' END;
      loc := r.next_step->>'station';
    ELSIF r.proof_ready_at IS NOT NULL THEN
      state := 'prova_hazir'; loc := 'Prova';
    ELSE
      state := 'belirsiz'; loc := NULL;
    END IF;

    members := members || jsonb_build_object('member_id', r.id, 'stage_no', r.stage_no,
      'cyl_code', r.cyl_code, 'member_kind', r.kind, 'team_code', r.team_code,
      'planned_ops', to_jsonb(r.planned_ops), 'state', state, 'station', loc,
      'open_op', r.open_op, 'next_step', r.next_step, 'issue_id', r.issue_id,
      'team_blocked_at', r.blocked_at, 'proof_ready_at', r.proof_ready_at);
  END LOOP;

  FOR r IN
    SELECT m.id, m.stage_no, m.removed_at, m.removed_reason, m.released_at,
           c.cyl_code, tm.team_code
      FROM public.team_members m
      JOIN public.teams tm ON tm.id = m.team_id
      LEFT JOIN public.cylinder_receipts c ON c.id = m.receipt_id
     WHERE tm.order_id = _order_id AND NOT m.is_active
     ORDER BY m.removed_at NULLS LAST
  LOOP
    hist := hist || jsonb_build_object('member_id', r.id, 'stage_no', r.stage_no,
      'cyl_code', r.cyl_code, 'removed_at', r.removed_at,
      'removed_reason', r.removed_reason, 'team_code', r.team_code);
  END LOOP;

  SELECT jsonb_build_object('order_id', ord.id, 'work_order_no', ord.work_order_no,
    'order_name', ord.name, 'quantity', ord.quantity, 'due_on', ord.due_on,
    'priority', ord.priority, 'critical_note', ord.critical_note,
    'closure_status', ord.closure_status, 'shipped_at', ord.shipped_at,
    'customer', (SELECT name FROM public.customers WHERE id = ord.customer_id),
    'members', members, 'historical', hist) INTO st;
  RETURN st;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.kanban_order_detail(uuid) TO authenticated, service_role;