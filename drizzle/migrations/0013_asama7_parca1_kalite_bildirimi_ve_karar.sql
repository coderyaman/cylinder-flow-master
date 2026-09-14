-- Aşama 7 / Parça 1: kalite bildirimi (uyarı vs. bloke), makine işgali ve yönetici kararı.

CREATE TYPE public.quality_action AS ENUM
  ('yeniden_kontrol', 'tekrar_islem', 'silindir_degisimi', 'bilinmiyor');
CREATE TYPE public.quality_status AS ENUM
  ('acik', 'bilgi_bekleniyor', 'karar_verildi', 'reddedildi');
CREATE TYPE public.quality_decision AS ENUM
  ('devam', 'rework', 'silindir_degisimi', 'red', 'ek_bilgi');
CREATE TYPE public.quality_responsibility AS ENUM
  ('ic_hata', 'musteri_revizyonu', 'bilinmiyor');

-- PRD 12.5 başlangıç listesi; Admin yönetir, pasif neden geçmişte okunmaya devam eder.
CREATE TABLE public.defect_categories (
  code text PRIMARY KEY,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  assessed_cause_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.defect_categories TO authenticated;
GRANT ALL ON public.defect_categories TO service_role;
ALTER TABLE public.defect_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY defect_categories_select ON public.defect_categories
  FOR SELECT TO authenticated USING (public.is_active_user(auth.uid()));

-- Bloke sırasında silindir makineden çıkarılmadıysa makine işgali korunur.
ALTER TABLE public.operations ADD COLUMN IF NOT EXISTS machine_held boolean NOT NULL DEFAULT false;
ALTER TABLE public.operations ADD COLUMN IF NOT EXISTS block_resolved_at timestamptz;
ALTER TABLE public.operations ADD COLUMN IF NOT EXISTS block_resolved_by uuid REFERENCES auth.users(id);

CREATE TABLE public.quality_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  operation_id uuid REFERENCES public.operations(id),
  receipt_id uuid REFERENCES public.cylinder_receipts(id),
  detected_station_id uuid NOT NULL REFERENCES public.stations(id),
  category_code text NOT NULL REFERENCES public.defect_categories(code),
  description text NOT NULL,
  proposed_action public.quality_action NOT NULL DEFAULT 'bilinmiyor',
  master_consult_note text,
  cylinder_removed boolean NOT NULL DEFAULT false,
  severity public.op_note_kind NOT NULL DEFAULT 'bloke',
  status public.quality_status NOT NULL DEFAULT 'acik',
  note_id uuid REFERENCES public.operation_notes(id),
  requested_by uuid REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decision public.quality_decision,
  decision_reason text,
  decided_by uuid REFERENCES auth.users(id),
  decided_at timestamptz,
  -- Tespit yeri, gözlenen hata, değerlendirilen kaynak neden ve ticari sorumluluk ayrı alanlardır.
  root_cause_code text REFERENCES public.defect_categories(code),
  responsibility public.quality_responsibility NOT NULL DEFAULT 'bilinmiyor',
  billable boolean,
  resolved_at timestamptz
);
CREATE INDEX quality_issues_status_idx ON public.quality_issues (status, requested_at DESC);
CREATE INDEX quality_issues_member_idx ON public.quality_issues (team_member_id);
GRANT SELECT ON public.quality_issues TO authenticated;
GRANT ALL ON public.quality_issues TO service_role;
ALTER TABLE public.quality_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY quality_issues_select ON public.quality_issues
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));

-- Operatör bildirimi: uyarı (üretim devam eder) veya bloke (yeni operasyon başlatılamaz).
CREATE OR REPLACE FUNCTION public.quality_report(
  _operation_id uuid,
  _severity public.op_note_kind,
  _category_code text,
  _description text,
  _proposed_action public.quality_action DEFAULT 'bilinmiyor',
  _master_consult_note text DEFAULT NULL,
  _cylinder_removed boolean DEFAULT false,
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid; cmd record; op public.operations; m public.team_members;
        cat public.defect_categories; note_id uuid; issue_id uuid;
BEGIN
  uid := public.assert_permission('quality.request');
  IF _severity = 'not' THEN RAISE EXCEPTION 'GECERSIZ: Uyarı veya bloke seçin.'; END IF;
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'quality_report',
    jsonb_build_object('op', _operation_id, 'sev', _severity, 'cat', _category_code,
      'desc', btrim(COALESCE(_description,'')), 'act', _proposed_action,
      'removed', _cylinder_removed));
  IF NOT cmd.is_new THEN
    RETURN jsonb_build_object('issue_id', cmd.prior, 'replayed', true);
  END IF;

  SELECT * INTO op FROM public.operations WHERE id = _operation_id FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Operasyon yok.'; END IF;
  PERFORM public.assert_station_allowed(uid, op.station_id);
  IF NULLIF(btrim(COALESCE(_description,'')),'') IS NULL THEN
    RAISE EXCEPTION 'GECERSIZ: Açıklama zorunludur.';
  END IF;
  SELECT * INTO cat FROM public.defect_categories WHERE code = _category_code;
  IF cat.code IS NULL OR NOT cat.is_active OR cat.assessed_cause_only THEN
    RAISE EXCEPTION 'GECERSIZ: Hata kategorisi seçilmelidir.';
  END IF;
  SELECT * INTO m FROM public.team_members WHERE id = op.team_member_id;

  INSERT INTO public.operation_notes (operation_id, team_member_id, receipt_id, kind, body, created_by)
  VALUES (_operation_id, m.id, m.receipt_id, _severity,
          cat.label || ' — ' || btrim(_description), uid)
  RETURNING id INTO note_id;

  IF _severity = 'bloke' THEN
    IF op.status = 'tamamlandi' THEN
      RAISE EXCEPTION 'GECERSIZ: Tamamlanmış operasyon bloke edilemez.';
    END IF;
    UPDATE public.operations
       SET status = 'bloke', machine_held = NOT COALESCE(_cylinder_removed, false)
     WHERE id = _operation_id;
  END IF;

  INSERT INTO public.quality_issues (team_member_id, operation_id, receipt_id,
    detected_station_id, category_code, description, proposed_action, master_consult_note,
    cylinder_removed, severity, note_id, requested_by,
    status, resolved_at)
  VALUES (m.id, _operation_id, m.receipt_id, op.station_id, cat.code, btrim(_description),
    COALESCE(_proposed_action,'bilinmiyor'), NULLIF(btrim(COALESCE(_master_consult_note,'')),''),
    COALESCE(_cylinder_removed,false), _severity, note_id, uid,
    CASE WHEN _severity = 'uyari' THEN 'acik'::public.quality_status ELSE 'acik'::public.quality_status END,
    NULL)
  RETURNING id INTO issue_id;

  PERFORM public.write_audit('quality.reported', 'quality_issues', issue_id::text, NULL,
    jsonb_build_object('operation_id', _operation_id, 'severity', _severity,
      'category', cat.code, 'proposed_action', _proposed_action,
      'cylinder_removed', _cylinder_removed, 'master_consulted',
      NULLIF(btrim(COALESCE(_master_consult_note,'')),'') IS NOT NULL), btrim(_description));
  PERFORM public.command_finish(_idempotency_key, issue_id::text);
  RETURN jsonb_build_object('issue_id', issue_id, 'replayed', false);
END;
$$;

-- Silindir makineden çıkarıldıysa makine bağı serbest bırakılır; makine arızası bununla kapanmaz.
CREATE OR REPLACE FUNCTION public.quality_release_machine(_issue_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid; iss public.quality_issues;
BEGIN
  uid := public.assert_permission('quality.request');
  SELECT * INTO iss FROM public.quality_issues WHERE id = _issue_id FOR UPDATE;
  IF iss.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Kayıt yok.'; END IF;
  UPDATE public.quality_issues SET cylinder_removed = true WHERE id = _issue_id;
  UPDATE public.operations SET machine_held = false WHERE id = iss.operation_id;
  PERFORM public.write_audit('quality.machine_released', 'quality_issues', _issue_id::text,
    NULL, jsonb_build_object('operation_id', iss.operation_id),
    'Silindir makineden çıkarıldı; makine bağı serbest bırakıldı. Makine arızası bu işlemle kapanmaz.');
END;
$$;

-- Yönetici kararı. Talebin reddi blokeyi kaldırmaz; devam kararı açıktır.
CREATE OR REPLACE FUNCTION public.quality_decide(
  _issue_id uuid,
  _decision public.quality_decision,
  _reason text,
  _root_cause_code text DEFAULT NULL,
  _responsibility public.quality_responsibility DEFAULT 'bilinmiyor',
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  -- İç hata varsayılan ücretsiz, müşteri revizyonu faturalandırılabilir,
  -- belirsiz sorumluluk otomatik sınıflandırılmaz.
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
      'block_cleared', false), btrim(_reason));
  PERFORM public.command_finish(_idempotency_key, _issue_id::text);
  RETURN jsonb_build_object('issue_id', _issue_id, 'status', new_status,
    'billable', bill, 'replayed', false);
END;
$$;

-- "İnceleme sonrası mevcut akışa devam" kararının açık uygulaması: bloke kaldırılır.
CREATE OR REPLACE FUNCTION public.quality_resume_flow(_issue_id uuid, _idempotency_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE uid uuid; cmd record; iss public.quality_issues; op public.operations;
        step public.route_steps; nxt public.route_steps; queued jsonb := NULL;
BEGIN
  uid := public.assert_permission('rework.approve');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'quality_resume_flow',
    jsonb_build_object('issue', _issue_id));
  IF NOT cmd.is_new THEN RETURN jsonb_build_object('issue_id', _issue_id, 'replayed', true); END IF;

  SELECT * INTO iss FROM public.quality_issues WHERE id = _issue_id FOR UPDATE;
  IF iss.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Kayıt yok.'; END IF;
  IF iss.decision IS DISTINCT FROM 'devam' THEN
    RAISE EXCEPTION 'GECERSIZ: Önce "mevcut akışa devam" kararı verilmelidir.';
  END IF;

  SELECT * INTO op FROM public.operations WHERE id = iss.operation_id FOR UPDATE;
  IF op.id IS NOT NULL AND op.status = 'bloke' AND op.block_resolved_at IS NULL THEN
    UPDATE public.operations
       SET block_resolved_at = now(), block_resolved_by = uid, machine_held = false
     WHERE id = op.id;
    -- Sorunlu biten iş normal başarı sayılmaz; adım kuyrukta kalır veya yeniden kuyruğa alınır.
    SELECT * INTO step FROM public.route_steps WHERE id = op.route_step_id FOR UPDATE;
    IF step.id IS NOT NULL AND step.status = 'kuyrukta' THEN
      queued := jsonb_build_object('step_id', step.id, 'op_label', step.op_label);
    ELSIF step.id IS NOT NULL AND step.status = 'tamamlandi' THEN
      SELECT * INTO nxt FROM public.route_steps
       WHERE plan_id = step.plan_id AND status = 'planlandi' AND seq > step.seq
       ORDER BY seq LIMIT 1 FOR UPDATE;
      IF nxt.id IS NOT NULL THEN
        UPDATE public.route_steps SET status = 'kuyrukta', queued_at = now() WHERE id = nxt.id;
        queued := jsonb_build_object('step_id', nxt.id, 'op_label', nxt.op_label);
      END IF;
    END IF;
  END IF;

  UPDATE public.operation_notes SET acknowledged_at = now(), acknowledged_by = uid
   WHERE id = iss.note_id AND acknowledged_at IS NULL;
  UPDATE public.quality_issues SET resolved_at = now() WHERE id = _issue_id;

  PERFORM public.write_audit('quality.resumed', 'quality_issues', _issue_id::text, NULL,
    jsonb_build_object('operation_id', iss.operation_id, 'queued', queued),
    'İnceleme sonrası mevcut akışa devam kararı uygulandı.');
  PERFORM public.command_finish(_idempotency_key, _issue_id::text);
  RETURN jsonb_build_object('issue_id', _issue_id, 'queued', queued, 'replayed', false);
END;
$$;

-- Makine işgali: bloke edilmiş ama silindir makineden çıkarılmamış iş makineyi tutar.
CREATE OR REPLACE FUNCTION public.op_start(
  _step_id uuid, _machine_id uuid, _qr_code text DEFAULT NULL,
  _skip_queue_reason text DEFAULT NULL, _idempotency_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
   ORDER BY rs.queued_at LIMIT 1;
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
$$;
