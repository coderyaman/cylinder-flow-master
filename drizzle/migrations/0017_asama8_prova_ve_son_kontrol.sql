-- Aşama 8: takım bazlı Prova ve son kontrol.
CREATE TYPE public.proof_result AS ENUM
  ('onaylandi','tekrar_prova','silindir_duzeltilecek','takim_yeniden');
CREATE TYPE public.proof_status AS ENUM ('devam','tamamlandi');

CREATE TABLE public.proof_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  round_no integer NOT NULL,
  machine_id uuid NOT NULL REFERENCES public.machines(id),
  status public.proof_status NOT NULL DEFAULT 'devam',
  result public.proof_result,
  category_code text REFERENCES public.defect_categories(code),
  note text,
  membership_fingerprint text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid REFERENCES auth.users(id),
  finished_at timestamptz,
  finished_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX proof_runs_active_uniq ON public.proof_runs(team_id) WHERE status = 'devam';
CREATE UNIQUE INDEX proof_runs_round_uniq ON public.proof_runs(team_id, round_no);
CREATE INDEX proof_runs_team_idx ON public.proof_runs(team_id);

CREATE TABLE public.proof_run_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.proof_runs(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  receipt_id uuid REFERENCES public.cylinder_receipts(id),
  stage_no integer,
  flagged boolean NOT NULL DEFAULT false,
  quality_issue_id uuid REFERENCES public.quality_issues(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, team_member_id)
);
CREATE INDEX proof_run_members_run_idx ON public.proof_run_members(run_id);

GRANT SELECT ON public.proof_runs TO authenticated;
GRANT SELECT ON public.proof_run_members TO authenticated;
GRANT ALL ON public.proof_runs TO service_role;
GRANT ALL ON public.proof_run_members TO service_role;

ALTER TABLE public.proof_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proof_run_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proof_runs_select" ON public.proof_runs
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));
CREATE POLICY "proof_run_members_select" ON public.proof_run_members
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS shipment_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipment_ready_fingerprint text,
  ADD COLUMN IF NOT EXISTS approved_run_id uuid REFERENCES public.proof_runs(id),
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocked_reason text;

ALTER TABLE public.quality_issues
  ADD COLUMN IF NOT EXISTS proof_run_id uuid REFERENCES public.proof_runs(id);

-- Onayın geçerliliği: üyelik + üretim + grafik bağlamının parmak izi.
-- Yalnızca açıklama düzeltmek bu değeri değiştirmez.
CREATE OR REPLACE FUNCTION public.team_proof_fingerprint(_team_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT md5(
    COALESCE((
      SELECT string_agg(x, '|' ORDER BY x) FROM (
        SELECT concat_ws(':', m.id::text, COALESCE(m.receipt_id::text,'-'),
          COALESCE(m.stage_no::text,'-'), COALESCE(m.proof_ready_at::text,'-'),
          COALESCE((SELECT concat_ws('/', rp.id::text, rp.version::text)
                      FROM public.route_plans rp
                     WHERE rp.team_member_id = m.id AND rp.status = 'yururlukte'), '-'),
          (SELECT count(*)::text FROM public.operations o WHERE o.team_member_id = m.id),
          COALESCE((SELECT max(o.finished_at)::text FROM public.operations o
                     WHERE o.team_member_id = m.id), '-'),
          COALESCE((SELECT max(om.measured_at)::text FROM public.operation_measurements om
                     WHERE om.team_member_id = m.id), '-')
        ) AS x
        FROM public.team_members m
       WHERE m.team_id = _team_id AND m.is_active
      ) s), '-')
    || '#' ||
    COALESCE((SELECT concat_ws('/', ga.id::text, ga.revision_no::text)
                FROM public.graphic_assets ga
                JOIN public.teams t ON t.order_id = ga.order_id
               WHERE t.id = _team_id AND ga.is_current LIMIT 1), '-')
  );
$fn$;
REVOKE ALL ON FUNCTION public.team_proof_fingerprint(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.team_proof_fingerprint(uuid) TO authenticated, service_role;

-- Prova hazırlık kapısı. Sunucuda değerlendirilir; eksikler gerekçeleriyle döner.
CREATE OR REPLACE FUNCTION public.proof_gate(_team_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE t public.teams; ord public.orders; blockers jsonb := '[]'::jsonb;
        warnings jsonb := '[]'::jsonb; members jsonb := '[]'::jsonb;
        physical integer; total_active integer; stages integer; distinct_stages integer;
        maxstage integer; fp text; r record; open_issues integer; active_run uuid;
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
    SELECT m.id, m.stage_no, m.proof_ready_at, m.receipt_id, m.kind,
           c.cyl_code, c.measured_circumference_mm, c.measured_diameter_mm,
           c.measured_length_mm, c.measurements_recorded,
           (SELECT count(*) FROM public.route_steps rs
              JOIN public.route_plans rp ON rp.id = rs.plan_id
             WHERE rp.team_member_id = m.id AND rp.status = 'yururlukte'
               AND rs.status IN ('planlandi','kuyrukta')) AS pending_steps,
           (SELECT count(*) FROM public.operations o
             WHERE o.team_member_id = m.id AND o.status IN ('devam','bloke')) AS open_ops,
           (SELECT count(*) FROM public.operation_notes n
             WHERE n.team_member_id = m.id AND n.kind = 'uyari'
               AND n.acknowledged_at IS NULL) AS open_warnings
      FROM public.team_members m
      LEFT JOIN public.cylinder_receipts c ON c.id = m.receipt_id
     WHERE m.team_id = _team_id AND m.is_active
     ORDER BY m.stage_no NULLS LAST, m.sequence_no
  LOOP
    members := members || jsonb_build_object('member_id', r.id, 'stage_no', r.stage_no,
      'cyl_code', r.cyl_code, 'kind', r.kind, 'receipt_id', r.receipt_id,
      'proof_ready_at', r.proof_ready_at, 'pending_steps', r.pending_steps,
      'open_ops', r.open_ops, 'open_warnings', r.open_warnings,
      'measurements_recorded', COALESCE(r.measurements_recorded, false),
      'circumference_mm', r.measured_circumference_mm,
      'diameter_mm', r.measured_diameter_mm, 'length_mm', r.measured_length_mm);

    IF r.receipt_id IS NULL THEN
      blockers := blockers || jsonb_build_object('code','PLANLANAN',
        'text','Planlanan imalat üyesi henüz fiziksel silindir değil.');
    ELSE
      IF r.pending_steps > 0 THEN
        blockers := blockers || jsonb_build_object('code','ROTA',
          'text', format('%s: gerekli üretim adımları tamamlanmadı.', r.cyl_code));
      END IF;
      IF r.open_ops > 0 THEN
        blockers := blockers || jsonb_build_object('code','ACIK_IS',
          'text', format('%s: devam eden veya blokeli operasyon var.', r.cyl_code));
      END IF;
      IF r.proof_ready_at IS NULL THEN
        blockers := blockers || jsonb_build_object('code','HAZIR_DEGIL',
          'text', format('%s: Prova İçin Hazır değil.', r.cyl_code));
      END IF;
      IF r.stage_no IS NULL THEN
        blockers := blockers || jsonb_build_object('code','KADEME',
          'text', format('%s: kademe atanmamış.', r.cyl_code));
      END IF;
    END IF;

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

  SELECT count(*) INTO open_issues FROM public.quality_issues q
    JOIN public.team_members m ON m.id = q.team_member_id
   WHERE m.team_id = _team_id AND m.is_active
     AND q.status IN ('acik','bilgi_bekleniyor');
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

-- Prova başlatma: tek takım operasyonu. QR okutmak başlatmaz.
CREATE OR REPLACE FUNCTION public.proof_start(
  _team_id uuid, _machine_id uuid, _qr_code text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid; cmd record; gate jsonb; mach public.machines; st public.stations;
        run_id uuid; rnd integer; qr text := upper(btrim(COALESCE(_qr_code,'')));
        ikey text := COALESCE(_idempotency_key, gen_random_uuid()::text);
BEGIN
  uid := public.assert_permission('operation.start');
  SELECT * INTO cmd FROM public.command_begin(ikey, 'proof_start',
    jsonb_build_object('team', _team_id, 'machine', _machine_id, 'qr', qr));
  IF NOT cmd.is_new THEN
    RETURN jsonb_build_object('run_id', cmd.prior, 'replayed', true);
  END IF;

  SELECT * INTO st FROM public.stations WHERE code = 'PROVA';
  PERFORM public.assert_station_allowed(uid, st.id);

  SELECT * INTO mach FROM public.machines WHERE id = _machine_id FOR UPDATE;
  IF mach.id IS NULL OR NOT mach.is_active THEN
    RAISE EXCEPTION 'GECERSIZ: Makine bulunamadı veya pasif.';
  END IF;
  IF mach.station_id <> st.id THEN
    RAISE EXCEPTION 'GECERSIZ: Makine Prova istasyonuna ait değil.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.proof_runs
              WHERE machine_id = _machine_id AND status = 'devam') THEN
    RAISE EXCEPTION 'MESGUL: Makinede devam eden bir Prova var.';
  END IF;

  IF qr <> '' AND NOT EXISTS (
      SELECT 1 FROM public.team_members m
        JOIN public.cylinder_receipts c ON c.id = m.receipt_id
       WHERE m.team_id = _team_id AND m.is_active AND c.cyl_code = qr) THEN
    RAISE EXCEPTION 'QR_UYUSMUYOR: Okutulan kod bu takımın aktif üyesi değil.';
  END IF;

  gate := public.proof_gate(_team_id);
  IF NOT (gate->>'ready')::boolean THEN
    RAISE EXCEPTION 'GECERSIZ: Prova hazırlık kapısı geçilmedi: %',
      COALESCE((SELECT string_agg(b->>'text', ' ') FROM jsonb_array_elements(gate->'blockers') b), '');
  END IF;

  SELECT COALESCE(max(round_no),0) + 1 INTO rnd FROM public.proof_runs WHERE team_id = _team_id;

  INSERT INTO public.proof_runs (team_id, round_no, machine_id, membership_fingerprint, started_by)
  VALUES (_team_id, rnd, _machine_id, gate->>'fingerprint', uid)
  RETURNING id INTO run_id;

  INSERT INTO public.proof_run_members (run_id, team_member_id, receipt_id, stage_no)
  SELECT run_id, m.id, m.receipt_id, m.stage_no
    FROM public.team_members m WHERE m.team_id = _team_id AND m.is_active;

  PERFORM public.write_audit('proof.started', 'proof_runs', run_id::text, NULL,
    jsonb_build_object('team_id', _team_id, 'round_no', rnd, 'machine_id', _machine_id,
      'fingerprint', gate->>'fingerprint'), NULL);
  PERFORM public.command_finish(ikey, run_id::text);
  RETURN jsonb_build_object('run_id', run_id, 'round_no', rnd, 'replayed', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.proof_start(uuid, uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.proof_start(uuid, uuid, text, text) TO authenticated, service_role;

-- Prova sonucu. Operatör yeniden üretimi onaylamaz; Müdür kararına düşer.
CREATE OR REPLACE FUNCTION public.proof_complete(
  _run_id uuid, _result public.proof_result, _note text DEFAULT NULL,
  _category_code text DEFAULT NULL, _member_ids uuid[] DEFAULT '{}',
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid; cmd record; run public.proof_runs; t public.teams; st public.stations;
        gate jsonb; fp text; targets uuid[]; mid uuid; iss_id uuid; created integer := 0;
        body text := NULLIF(btrim(COALESCE(_note,'')),'');
        ikey text := COALESCE(_idempotency_key, gen_random_uuid()::text);
BEGIN
  uid := public.assert_permission('operation.complete');
  SELECT * INTO cmd FROM public.command_begin(ikey, 'proof_complete',
    jsonb_build_object('run', _run_id, 'result', _result, 'note', body,
      'category', _category_code, 'members', to_jsonb(COALESCE(_member_ids,'{}'::uuid[]))));
  IF NOT cmd.is_new THEN
    RETURN jsonb_build_object('run_id', _run_id, 'replayed', true);
  END IF;

  SELECT * INTO run FROM public.proof_runs WHERE id = _run_id FOR UPDATE;
  IF run.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Prova kaydı yok.'; END IF;
  IF run.status <> 'devam' THEN
    RAISE EXCEPTION 'GECERSIZ: Bu Prova zaten sonuçlandırılmış.';
  END IF;
  SELECT * INTO st FROM public.stations WHERE code = 'PROVA';
  PERFORM public.assert_station_allowed(uid, st.id);
  SELECT * INTO t FROM public.teams WHERE id = run.team_id FOR UPDATE;

  IF _result IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Sonuç zorunludur.'; END IF;

  IF _result <> 'onaylandi' THEN
    IF body IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Açıklama zorunludur.'; END IF;
    IF _category_code IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.defect_categories
                       WHERE code = _category_code AND is_active
                         AND NOT assessed_cause_only) THEN
      RAISE EXCEPTION 'GECERSIZ: Geçerli bir hata kategorisi seçilmelidir.';
    END IF;
  END IF;

  fp := public.team_proof_fingerprint(run.team_id);

  IF _result = 'onaylandi' THEN
    IF fp <> run.membership_fingerprint THEN
      RAISE EXCEPTION 'GECERSIZ: Prova sırasında takım veya üretim bağlamı değişti; yeni Prova turu gerekir.';
    END IF;
    gate := public.proof_gate(run.team_id);
    IF (SELECT count(*) FROM jsonb_array_elements(gate->'blockers') b
         WHERE b->>'code' <> 'AKTIF_PROVA') > 0 THEN
      RAISE EXCEPTION 'GECERSIZ: Takım artık Prova koşullarını sağlamıyor.';
    END IF;
    UPDATE public.teams
       SET shipment_ready_at = now(), shipment_ready_fingerprint = fp, approved_run_id = run.id
     WHERE id = run.team_id;
  ELSE
    UPDATE public.teams
       SET shipment_ready_at = NULL, shipment_ready_fingerprint = NULL, approved_run_id = NULL
     WHERE id = run.team_id;
  END IF;

  IF _result = 'silindir_duzeltilecek' THEN
    targets := COALESCE(_member_ids, '{}');
    IF array_length(targets,1) IS NULL THEN
      RAISE EXCEPTION 'GECERSIZ: En az bir aktif üye seçilmelidir.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(targets) x
                WHERE NOT EXISTS (SELECT 1 FROM public.team_members m
                                   WHERE m.id = x AND m.team_id = run.team_id AND m.is_active)) THEN
      RAISE EXCEPTION 'GECERSIZ: Seçilen üye bu takımın aktif üyesi değil.';
    END IF;
  ELSIF _result = 'takim_yeniden' THEN
    -- Güncel üyelerin tamamı otomatik etki kapsamındadır; operatöre seçtirilmez.
    SELECT array_agg(m.id) INTO targets FROM public.team_members m
     WHERE m.team_id = run.team_id AND m.is_active;
    UPDATE public.teams SET blocked_at = now(), blocked_reason = body WHERE id = run.team_id;
  ELSE
    targets := '{}';
  END IF;

  IF array_length(targets,1) IS NOT NULL THEN
    FOREACH mid IN ARRAY targets LOOP
      INSERT INTO public.quality_issues (team_member_id, receipt_id, detected_station_id,
        category_code, description, proposed_action, cylinder_removed, severity, status,
        responsibility, requested_by, proof_run_id)
      SELECT m.id, m.receipt_id, st.id, _category_code, body, 'bilinmiyor', true,
             'bloke', 'acik', 'bilinmiyor', uid, run.id
        FROM public.team_members m WHERE m.id = mid
      RETURNING id INTO iss_id;
      UPDATE public.proof_run_members SET flagged = true, quality_issue_id = iss_id
       WHERE run_id = run.id AND team_member_id = mid;
      created := created + 1;
    END LOOP;
  END IF;

  UPDATE public.proof_runs
     SET status = 'tamamlandi', result = _result, note = body,
         category_code = _category_code, finished_at = now(), finished_by = uid
   WHERE id = run.id;

  PERFORM public.write_audit('proof.completed', 'proof_runs', run.id::text,
    jsonb_build_object('round_no', run.round_no),
    jsonb_build_object('team_id', run.team_id, 'result', _result,
      'category', _category_code, 'issues_created', created,
      'fingerprint', fp), body);
  PERFORM public.command_finish(ikey, run.id::text);
  RETURN jsonb_build_object('run_id', run.id, 'result', _result,
    'issues_created', created, 'shipment_ready', _result = 'onaylandi', 'replayed', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.proof_complete(uuid, public.proof_result, text, text, uuid[], text)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.proof_complete(uuid, public.proof_result, text, text, uuid[], text)
  TO authenticated, service_role;

-- Takım blokesini yalnızca Prova geri dönüş yetkisi olan kişi kaldırır.
CREATE OR REPLACE FUNCTION public.proof_release_hold(
  _team_id uuid, _reason text, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid; cmd record; t public.teams; open_issues integer;
        ikey text := COALESCE(_idempotency_key, gen_random_uuid()::text);
BEGIN
  uid := public.assert_permission('proof.rework.approve');
  SELECT * INTO cmd FROM public.command_begin(ikey, 'proof_release_hold',
    jsonb_build_object('team', _team_id, 'reason', NULLIF(btrim(COALESCE(_reason,'')),'')));
  IF NOT cmd.is_new THEN
    RETURN jsonb_build_object('team_id', _team_id, 'replayed', true);
  END IF;
  IF NULLIF(btrim(COALESCE(_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'GECERSIZ: Gerekçe zorunludur.';
  END IF;
  SELECT * INTO t FROM public.teams WHERE id = _team_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Takım yok.'; END IF;

  SELECT count(*) INTO open_issues FROM public.quality_issues q
    JOIN public.team_members m ON m.id = q.team_member_id
   WHERE m.team_id = _team_id AND m.is_active
     AND q.status IN ('acik','bilgi_bekleniyor');
  IF open_issues > 0 THEN
    RAISE EXCEPTION 'GECERSIZ: Karar bekleyen % kalite talebi var.', open_issues;
  END IF;

  UPDATE public.teams SET blocked_at = NULL, blocked_reason = NULL WHERE id = _team_id;
  PERFORM public.write_audit('proof.hold_released', 'teams', _team_id::text,
    jsonb_build_object('blocked_at', t.blocked_at), NULL, btrim(_reason));
  PERFORM public.command_finish(ikey, _team_id::text);
  RETURN jsonb_build_object('team_id', _team_id, 'replayed', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.proof_release_hold(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.proof_release_hold(uuid, text, text) TO authenticated, service_role;

-- Prova kaynaklı taleplerde normal karar yetkisi Müdür'dedir.
CREATE OR REPLACE FUNCTION public.quality_decide(
  _issue_id uuid,
  _decision public.quality_decision,
  _reason text,
  _root_cause_code text DEFAULT NULL,
  _responsibility public.quality_responsibility DEFAULT 'bilinmiyor',
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE uid uuid; cmd record; iss public.quality_issues; bill boolean;
        new_status public.quality_status;
BEGIN
  uid := public.assert_permission('rework.approve');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'quality_decide',
    jsonb_build_object('issue', _issue_id, 'decision', _decision,
      'reason', btrim(COALESCE(_reason,'')), 'cause', _root_cause_code,
      'resp', _responsibility));
  IF NOT cmd.is_new THEN
    RETURN jsonb_build_object('issue_id', _issue_id, 'replayed', true);
  END IF;

  SELECT * INTO iss FROM public.quality_issues WHERE id = _issue_id FOR UPDATE;
  IF iss.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Kayıt yok.'; END IF;
  IF iss.proof_run_id IS NOT NULL THEN
    PERFORM public.assert_permission('proof.rework.approve');
  END IF;
  IF iss.status IN ('karar_verildi','reddedildi') THEN
    RAISE EXCEPTION 'GECERSIZ: Bu talep için karar zaten verilmiş.';
  END IF;
  IF NULLIF(btrim(COALESCE(_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'GECERSIZ: Karar gerekçesi zorunludur.';
  END IF;
  IF _root_cause_code IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.defect_categories WHERE code = _root_cause_code) THEN
    RAISE EXCEPTION 'GECERSIZ: Kaynak neden tanımlı değil.';
  END IF;

  bill := CASE COALESCE(_responsibility,'bilinmiyor')
            WHEN 'ic_hata' THEN false
            WHEN 'musteri_revizyonu' THEN true
            ELSE NULL END;

  new_status := CASE _decision
    WHEN 'red' THEN 'reddedildi'::public.quality_status
    WHEN 'ek_bilgi' THEN 'bilgi_bekleniyor'::public.quality_status
    ELSE 'karar_verildi'::public.quality_status END;

  UPDATE public.quality_issues
     SET decision = _decision, decision_reason = btrim(_reason), decided_by = uid,
         decided_at = now(), root_cause_code = _root_cause_code,
         responsibility = COALESCE(_responsibility,'bilinmiyor'), billable = bill,
         status = new_status
   WHERE id = _issue_id;

  PERFORM public.write_audit('quality.decided', 'quality_issues', _issue_id::text,
    jsonb_build_object('status', iss.status),
    jsonb_build_object('decision', _decision, 'root_cause', _root_cause_code,
      'responsibility', _responsibility, 'billable', bill,
      'proof_run_id', iss.proof_run_id, 'block_cleared', false), btrim(_reason));
  PERFORM public.command_finish(_idempotency_key, _issue_id::text);
  RETURN jsonb_build_object('issue_id', _issue_id, 'status', new_status,
    'billable', bill, 'replayed', false);
END;
$fn$;

-- Prova operatörüne takımın güncel grafik revizyonu için erişim.
CREATE OR REPLACE FUNCTION private.team_graphic_grant(_actor uuid, _team_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private AS $fn$
DECLARE a public.graphic_assets; st public.stations; t public.teams;
BEGIN
  IF NOT private.has_permission_internal(_actor, 'operation.start') THEN
    RAISE EXCEPTION 'YETKISIZ: Operasyon yetkiniz yok.';
  END IF;
  SELECT * INTO t FROM public.teams WHERE id = _team_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Takım yok.'; END IF;
  SELECT * INTO st FROM public.stations WHERE code = 'PROVA';
  IF NOT private.station_allowed_internal(_actor, st.id) THEN
    RAISE EXCEPTION 'YETKISIZ: Bu istasyonda işlem yetkiniz yok.';
  END IF;
  SELECT * INTO a FROM public.graphic_assets
   WHERE order_id = t.order_id AND is_current LIMIT 1;
  IF a.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Siparişin güncel grafik dosyası yok.'; END IF;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_value, reason)
  VALUES (_actor, 'graphic_asset.proof_link', 'graphic_assets', a.id::text,
    jsonb_build_object('team_id', t.id, 'revision_no', a.revision_no),
    'Prova için güncel revizyon erişim bağlantısı oluşturuldu');

  RETURN jsonb_build_object('storage_path', a.storage_path, 'filename', a.filename,
    'revision_no', a.revision_no);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.srv_team_graphic(_actor uuid, _team_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $fn$ SELECT private.team_graphic_grant(_actor, _team_id); $fn$;
REVOKE ALL ON FUNCTION public.srv_team_graphic(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_team_graphic(uuid, uuid) TO service_role;