-- Aşama 8 tamamlama: Prova hazırlık kapısı artık her üye için
-- eksik nedenini ve sonraki işlemin hedefini de döndürür.
CREATE OR REPLACE FUNCTION public.proof_gate(_team_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE t public.teams; ord public.orders; blockers jsonb := '[]'::jsonb;
        warnings jsonb := '[]'::jsonb; members jsonb := '[]'::jsonb;
        decisions jsonb := '[]'::jsonb;
        physical integer; total_active integer; stages integer; distinct_stages integer;
        maxstage integer; fp text; r record; d record; open_issues integer; active_run uuid;
        mblock jsonb;
BEGIN
  SELECT * INTO t FROM public.teams WHERE id = _team_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Takım yok.'; END IF;
  SELECT * INTO ord FROM public.orders WHERE id = t.order_id;

  SELECT count(*) FILTER (WHERE receipt_id IS NOT NULL), count(*)
    INTO physical, total_active
    FROM public.team_members WHERE team_id = _team_id AND is_active;

  IF ord.closure_status = 'iptal' THEN
    blockers := blockers || jsonb_build_object('code','IPTAL','text','Sipariş iptal edilmiş.');
  END IF;

  IF physical <> ord.quantity THEN
    blockers := blockers || jsonb_build_object('code','ADET',
      'text', format('Fiziksel üye sayısı %s, sipariş adedi %s. Planlanan veya değiştirilen üyeler hazır sayılmaz.',
                     physical, ord.quantity));
  END IF;

  FOR r IN
    SELECT m.id, m.stage_no, m.proof_ready_at, m.receipt_id, m.kind, m.planned_ops,
           c.cyl_code, c.measured_circumference_mm, c.measured_diameter_mm,
           c.measured_length_mm, c.measurements_recorded,
           (SELECT count(*) FROM public.route_plans rp
             WHERE rp.team_member_id = m.id AND rp.status = 'yururlukte') AS plans,
           (SELECT count(*) FROM public.route_steps rs
              JOIN public.route_plans rp ON rp.id = rs.plan_id
             WHERE rp.team_member_id = m.id AND rp.status = 'yururlukte'
               AND rs.status IN ('planlandi','kuyrukta')) AS pending_steps,
           (SELECT count(*) FROM public.operations o
             WHERE o.team_member_id = m.id AND o.status IN ('devam','bloke')) AS open_ops,
           (SELECT count(*) FROM public.operation_notes n
             WHERE n.team_member_id = m.id AND n.kind = 'uyari'
               AND n.acknowledged_at IS NULL) AS open_warnings,
           (SELECT jsonb_build_object('step_id', rs.id, 'station_code', s.code,
                     'station_name', s.name, 'op_label', rs.op_label, 'status', rs.status)
              FROM public.route_steps rs
              JOIN public.route_plans rp ON rp.id = rs.plan_id
              JOIN public.stations s ON s.id = rs.station_id
             WHERE rp.team_member_id = m.id AND rp.status = 'yururlukte'
               AND rs.status IN ('planlandi','kuyrukta')
             ORDER BY rs.seq LIMIT 1) AS next_step,
           (SELECT jsonb_build_object('operation_id', o.id, 'station_code', s.code,
                     'station_name', s.name, 'status', o.status)
              FROM public.operations o JOIN public.stations s ON s.id = o.station_id
             WHERE o.team_member_id = m.id AND o.status IN ('devam','bloke')
             ORDER BY o.started_at LIMIT 1) AS open_op,
           (SELECT jsonb_build_object('issue_id', q.id, 'status', q.status,
                     'severity', q.severity, 'decision', q.decision,
                     'proof_run_id', q.proof_run_id, 'description', q.description)
              FROM public.quality_issues q
             WHERE q.team_member_id = m.id AND q.status IN ('acik','bilgi_bekleniyor')
             ORDER BY q.requested_at LIMIT 1) AS open_issue
      FROM public.team_members m
      LEFT JOIN public.cylinder_receipts c ON c.id = m.receipt_id
     WHERE m.team_id = _team_id AND m.is_active
     ORDER BY m.stage_no NULLS LAST, m.sequence_no
  LOOP
    mblock := '[]'::jsonb;

    IF r.receipt_id IS NULL THEN
      mblock := mblock || jsonb_build_object('code','PLANLANAN',
        'text','Henüz imal edilmedi; Torna istasyonunda gerçek silindir oluşturulmalı.');
      blockers := blockers || jsonb_build_object('code','PLANLANAN',
        'text','Planlanan imalat üyesi henüz fiziksel silindir değil.');
    END IF;

    IF r.plans = 0 THEN
      mblock := mblock || jsonb_build_object('code','URETIME_ALINMADI',
        'text','Üretime alınmayı bekliyor; yürürlükte rota yok.');
      blockers := blockers || jsonb_build_object('code','URETIME_ALINMADI',
        'text', format('%s: üretime alınmayı bekliyor.', COALESCE(r.cyl_code,'Planlanan üye')));
    END IF;

    IF r.receipt_id IS NOT NULL THEN
      IF r.pending_steps > 0 THEN
        mblock := mblock || jsonb_build_object('code','ROTA',
          'text', format('%s adımı tamamlanmadı (%s).',
            COALESCE(r.next_step->>'station_name','Üretim'),
            CASE r.next_step->>'status' WHEN 'kuyrukta' THEN 'kuyrukta' ELSE 'planlandı' END));
        blockers := blockers || jsonb_build_object('code','ROTA',
          'text', format('%s: gerekli üretim adımları tamamlanmadı.', r.cyl_code));
      END IF;
      IF r.open_ops > 0 THEN
        mblock := mblock || jsonb_build_object('code','ACIK_IS',
          'text', format('%s istasyonunda %s durumda operasyon var.',
            COALESCE(r.open_op->>'station_name','Üretim'), r.open_op->>'status'));
        blockers := blockers || jsonb_build_object('code','ACIK_IS',
          'text', format('%s: devam eden veya blokeli operasyon var.', r.cyl_code));
      END IF;
      IF r.proof_ready_at IS NULL AND r.pending_steps = 0 AND r.open_ops = 0 AND r.plans > 0 THEN
        mblock := mblock || jsonb_build_object('code','HAZIR_DEGIL',
          'text','Prova İçin Hazır değil; Krom operasyonu başarıyla tamamlanmalı.');
      END IF;
      IF r.proof_ready_at IS NULL THEN
        blockers := blockers || jsonb_build_object('code','HAZIR_DEGIL',
          'text', format('%s: Prova İçin Hazır değil.', r.cyl_code));
      END IF;
      IF r.stage_no IS NULL THEN
        mblock := mblock || jsonb_build_object('code','KADEME',
          'text','Kademe atanmamış; Taşlama tamamlanırken kademe girilmeli.');
        blockers := blockers || jsonb_build_object('code','KADEME',
          'text', format('%s: kademe atanmamış.', r.cyl_code));
      END IF;
    END IF;

    IF r.open_issue IS NOT NULL THEN
      mblock := mblock || jsonb_build_object('code','KARAR_BEKLIYOR',
        'text', CASE r.open_issue->>'status'
                  WHEN 'bilgi_bekleniyor' THEN 'Kalite kaydı ek bilgi bekliyor.'
                  ELSE 'Kalite kaydı Müdür kararı bekliyor.' END,
        'issue_id', r.open_issue->>'issue_id');
    END IF;

    members := members || jsonb_build_object('member_id', r.id, 'stage_no', r.stage_no,
      'cyl_code', r.cyl_code, 'kind', r.kind, 'receipt_id', r.receipt_id,
      'proof_ready_at', r.proof_ready_at, 'pending_steps', r.pending_steps,
      'open_ops', r.open_ops, 'open_warnings', r.open_warnings,
      'measurements_recorded', COALESCE(r.measurements_recorded, false),
      'circumference_mm', r.measured_circumference_mm,
      'diameter_mm', r.measured_diameter_mm, 'length_mm', r.measured_length_mm,
      'has_plan', r.plans > 0, 'next_step', r.next_step, 'open_op', r.open_op,
      'open_issue', r.open_issue, 'issues', mblock);

    IF r.open_warnings > 0 THEN
      warnings := warnings || jsonb_build_object('cyl_code', r.cyl_code,
        'count', r.open_warnings,
        'text', format('%s: kapatılmamış uyarı var (bloke değildir).', COALESCE(r.cyl_code,'Planlanan üye')));
    END IF;
  END LOOP;

  SELECT count(stage_no), count(DISTINCT stage_no), max(stage_no)
    INTO stages, distinct_stages, maxstage
    FROM public.team_members WHERE team_id = _team_id AND is_active;
  IF total_active > 0 AND (stages <> total_active OR distinct_stages <> total_active
      OR COALESCE(maxstage,0) <> total_active) THEN
    blockers := blockers || jsonb_build_object('code','KADEME_BUTUN',
      'text','Kademeler 1…N aralığında, benzersiz ve eksiksiz değil.');
  END IF;

  FOR d IN
    SELECT q.id, q.status, q.severity, q.description, q.proof_run_id, q.decision,
           q.requested_at, m.stage_no, c.cyl_code
      FROM public.quality_issues q
      JOIN public.team_members m ON m.id = q.team_member_id
      LEFT JOIN public.cylinder_receipts c ON c.id = m.receipt_id
     WHERE m.team_id = _team_id AND m.is_active
       AND q.status IN ('acik','bilgi_bekleniyor')
     ORDER BY q.requested_at
  LOOP
    decisions := decisions || jsonb_build_object('issue_id', d.id, 'status', d.status,
      'severity', d.severity, 'description', d.description, 'proof_run_id', d.proof_run_id,
      'requested_at', d.requested_at, 'stage_no', d.stage_no, 'cyl_code', d.cyl_code);
  END LOOP;

  open_issues := jsonb_array_length(decisions);
  IF open_issues > 0 THEN
    blockers := blockers || jsonb_build_object('code','KARAR_BEKLIYOR',
      'text', format('%s adet kalite talebi Müdür kararı bekliyor.', open_issues));
  END IF;

  IF t.blocked_at IS NOT NULL THEN
    blockers := blockers || jsonb_build_object('code','TAKIM_BLOKE',
      'text', COALESCE('Takım bloke: ' || t.blocked_reason, 'Takım bloke; Müdür kararı bekleniyor.'));
  END IF;

  SELECT id INTO active_run FROM public.proof_runs
   WHERE team_id = _team_id AND status = 'devam';
  IF active_run IS NOT NULL THEN
    blockers := blockers || jsonb_build_object('code','AKTIF_PROVA',
      'text','Bu takımda devam eden bir Prova var.');
  END IF;

  fp := public.team_proof_fingerprint(_team_id);

  RETURN jsonb_build_object(
    'team_id', _team_id, 'team_code', t.team_code, 'order_id', ord.id,
    'work_order_no', ord.work_order_no, 'order_name', ord.name,
    'quantity', ord.quantity, 'due_on', ord.due_on, 'priority', ord.priority,
    'critical_note', ord.critical_note,
    'customer', (SELECT name FROM public.customers WHERE id = ord.customer_id),
    'physical_members', physical, 'active_members', total_active,
    'members', members, 'blockers', blockers, 'warnings', warnings,
    'pending_decisions', decisions,
    'blocked_at', t.blocked_at, 'blocked_reason', t.blocked_reason,
    'ready', jsonb_array_length(blockers) = 0,
    'active_run_id', active_run,
    'fingerprint', fp,
    'shipment_ready_at', t.shipment_ready_at,
    'approval_valid', t.shipment_ready_at IS NOT NULL
                      AND t.shipment_ready_fingerprint = fp,
    'approved_run_id', t.approved_run_id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.proof_gate(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.proof_gate(uuid) TO authenticated, service_role;