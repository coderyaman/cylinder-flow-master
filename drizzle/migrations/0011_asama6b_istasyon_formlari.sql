-- Aşama 6B: Bakır, Taşlama, CFM, Gravür, Krom operatör formları.
-- Ölçümler yeni geçmiş kaydıdır; depo ölçümünün üzerine yazılmaz.

CREATE TYPE public.bakir_work AS ENUM (
  'bakir_kaplama','ana_kaplama','cevre_yukseltme','cevre_dusurme','nokta_tamiri'
);

ALTER TABLE public.operations
  ADD COLUMN IF NOT EXISTS bakir_works public.bakir_work[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS graphic_asset_id uuid REFERENCES public.graphic_assets(id);

ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS stage_no integer,
  ADD COLUMN IF NOT EXISTS proof_ready_at timestamptz;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS proof_queued_at timestamptz;

-- Aktif takımda aynı kademe iki üyeye atanamaz.
CREATE UNIQUE INDEX IF NOT EXISTS team_members_stage_uniq
  ON public.team_members(team_id, stage_no)
  WHERE is_active AND stage_no IS NOT NULL;

-- Operasyon ölçüm geçmişi. Operasyon başına tek kayıt: tekrar gönderim ikinci ölçüm üretmez.
CREATE TABLE IF NOT EXISTS public.operation_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL UNIQUE REFERENCES public.operations(id),
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  receipt_id uuid REFERENCES public.cylinder_receipts(id),
  station_code text NOT NULL,
  round_no integer NOT NULL DEFAULT 1,
  circumference_mm numeric,
  diameter_mm numeric,
  coating_thickness_um numeric,
  note text,
  measured_by uuid REFERENCES auth.users(id),
  measured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operation_measurements_member_idx
  ON public.operation_measurements(team_member_id);

GRANT SELECT ON public.operation_measurements TO authenticated;
GRANT ALL ON public.operation_measurements TO service_role;
ALTER TABLE public.operation_measurements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "operation_measurements_select" ON public.operation_measurements;
CREATE POLICY "operation_measurements_select" ON public.operation_measurements
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));

-- Ortak tamamlama girişi: yetki, istasyon, durum ve kilit denetimi.
CREATE OR REPLACE FUNCTION public.op_open_for_complete(_op_id uuid, _station_code text, _uid uuid)
RETURNS public.operations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE op public.operations; st public.stations;
BEGIN
  SELECT * INTO op FROM public.operations WHERE id = _op_id FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Operasyon yok.'; END IF;
  IF op.status <> 'devam' THEN
    RAISE EXCEPTION 'GECERSIZ: Operasyon devam etmiyor (%). Tamamlanan kayıt değiştirilemez.', op.status;
  END IF;
  SELECT * INTO st FROM public.stations WHERE id = op.station_id;
  IF st.code <> _station_code THEN
    RAISE EXCEPTION 'GECERSIZ: Bu form yalnızca % istasyonu içindir.', _station_code;
  END IF;
  PERFORM public.assert_station_allowed(_uid, op.station_id);
  RETURN op;
END;
$$;
REVOKE ALL ON FUNCTION public.op_open_for_complete(uuid, text, uuid) FROM public, anon, authenticated;

-- Ölçüm kaydı: sıfır/negatif reddedilir, ölçülmemiş alan kaydedilmez.
CREATE OR REPLACE FUNCTION public.op_record_measurement(
  _op public.operations, _station_code text, _uid uuid,
  _circ numeric, _diam numeric, _coating numeric, _note text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.team_members;
BEGIN
  IF _circ IS NULL AND _diam IS NULL AND _coating IS NULL THEN RETURN; END IF;
  IF (_circ IS NOT NULL AND _circ <= 0) OR (_diam IS NOT NULL AND _diam <= 0)
     OR (_coating IS NOT NULL AND _coating <= 0) THEN
    RAISE EXCEPTION 'GECERSIZ: Ölçüm sıfır veya negatif olamaz.';
  END IF;
  SELECT * INTO m FROM public.team_members WHERE id = _op.team_member_id;
  INSERT INTO public.operation_measurements (operation_id, team_member_id, receipt_id,
    station_code, round_no, circumference_mm, diameter_mm, coating_thickness_um, note, measured_by)
  VALUES (_op.id, m.id, m.receipt_id, _station_code, _op.round_no,
    _circ, _diam, _coating, NULLIF(btrim(COALESCE(_note,'')),''), _uid)
  ON CONFLICT (operation_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.op_record_measurement(public.operations, text, uuid, numeric, numeric, numeric, text) FROM public, anon, authenticated;

-- 11.3 Bakır Kaplama
CREATE OR REPLACE FUNCTION public.op_complete_bakir(
  _operation_id uuid, _result public.op_result, _works public.bakir_work[],
  _circumference_mm numeric DEFAULT NULL, _diameter_mm numeric DEFAULT NULL,
  _coating_thickness_um numeric DEFAULT NULL,
  _note text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; op public.operations; res jsonb;
        works public.bakir_work[] := COALESCE(_works, '{}');
BEGIN
  uid := public.assert_permission('operation.complete');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'op_complete_bakir',
    jsonb_build_object('operation_id', _operation_id, 'result', _result,
      'works', to_jsonb(works), 'circ', _circumference_mm, 'diam', _diameter_mm,
      'coating', _coating_thickness_um, 'note', NULLIF(btrim(COALESCE(_note,'')),'')));
  IF NOT cmd.is_new THEN RETURN cmd.prior::jsonb || jsonb_build_object('replayed', true); END IF;

  op := public.op_open_for_complete(_operation_id, 'BAKIR', uid);
  IF _result IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Sonuç zorunludur.'; END IF;

  IF _result = 'basarili' THEN
    IF array_length(works, 1) IS NULL THEN
      RAISE EXCEPTION 'GECERSIZ: Yapılan iş/işler zorunludur.';
    END IF;
    IF _circumference_mm IS NULL OR _diameter_mm IS NULL OR _coating_thickness_um IS NULL THEN
      RAISE EXCEPTION 'GECERSIZ: Son çevre, son çap ve kaplama kalınlığı zorunludur.';
    END IF;
  END IF;

  UPDATE public.operations SET bakir_works = works WHERE id = _operation_id;
  PERFORM public.op_record_measurement(op, 'BAKIR', uid,
    _circumference_mm, _diameter_mm, _coating_thickness_um, _note);

  res := public.op_close_common(_operation_id, uid, _result, _note, true);
  PERFORM public.write_audit('operation.completed', 'operations', _operation_id::text, NULL,
    jsonb_build_object('station', 'BAKIR', 'result', _result, 'works', to_jsonb(works),
      'circumference_mm', _circumference_mm, 'diameter_mm', _diameter_mm,
      'coating_thickness_um', _coating_thickness_um), _note);
  PERFORM public.command_finish(_idempotency_key, res::text);
  RETURN res || jsonb_build_object('replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.op_complete_bakir(uuid, public.op_result, public.bakir_work[], numeric, numeric, numeric, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.op_complete_bakir(uuid, public.op_result, public.bakir_work[], numeric, numeric, numeric, text, text) TO authenticated, service_role;

-- 11.4 Taşlama: kademe üyeliğe bağlanır, aktif takımda tekildir.
CREATE OR REPLACE FUNCTION public.op_complete_taslama(
  _operation_id uuid, _result public.op_result, _stage_no integer DEFAULT NULL,
  _circumference_mm numeric DEFAULT NULL, _diameter_mm numeric DEFAULT NULL,
  _note text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; op public.operations; m public.team_members;
        total integer; res jsonb;
BEGIN
  uid := public.assert_permission('operation.complete');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'op_complete_taslama',
    jsonb_build_object('operation_id', _operation_id, 'result', _result, 'stage', _stage_no,
      'circ', _circumference_mm, 'diam', _diameter_mm,
      'note', NULLIF(btrim(COALESCE(_note,'')),'')));
  IF NOT cmd.is_new THEN RETURN cmd.prior::jsonb || jsonb_build_object('replayed', true); END IF;

  op := public.op_open_for_complete(_operation_id, 'TASLAMA', uid);
  IF _result IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Sonuç zorunludur.'; END IF;
  SELECT * INTO m FROM public.team_members WHERE id = op.team_member_id FOR UPDATE;

  IF _result = 'basarili' THEN
    IF _stage_no IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Kademe/Renk sırası zorunludur.'; END IF;
    IF _circumference_mm IS NULL OR _diameter_mm IS NULL THEN
      RAISE EXCEPTION 'GECERSIZ: Son çevre ve son çap zorunludur.';
    END IF;
    SELECT count(*) INTO total FROM public.team_members
     WHERE team_id = m.team_id AND is_active;
    IF _stage_no < 1 OR _stage_no > total THEN
      RAISE EXCEPTION 'GECERSIZ: Kademe 1 ile % arasında olmalıdır.', total;
    END IF;
    IF EXISTS (SELECT 1 FROM public.team_members
                WHERE team_id = m.team_id AND is_active AND id <> m.id
                  AND stage_no = _stage_no) THEN
      RAISE EXCEPTION 'GECERSIZ: Bu kademe aktif takımda başka bir silindire atanmış.';
    END IF;
    UPDATE public.team_members SET stage_no = _stage_no WHERE id = m.id;
  END IF;

  PERFORM public.op_record_measurement(op, 'TASLAMA', uid,
    _circumference_mm, _diameter_mm, NULL, _note);

  res := public.op_close_common(_operation_id, uid, _result, _note, true);
  PERFORM public.write_audit('operation.completed', 'operations', _operation_id::text, NULL,
    jsonb_build_object('station', 'TASLAMA', 'result', _result, 'stage_no', _stage_no,
      'circumference_mm', _circumference_mm, 'diameter_mm', _diameter_mm), _note);
  PERFORM public.command_finish(_idempotency_key, res::text);
  RETURN res || jsonb_build_object('replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.op_complete_taslama(uuid, public.op_result, integer, numeric, numeric, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.op_complete_taslama(uuid, public.op_result, integer, numeric, numeric, text, text) TO authenticated, service_role;

-- 11.5 CFM / Parlatma ve 11.6 Gravür: ek teknik ölçüm yok.
CREATE OR REPLACE FUNCTION public.op_complete_simple(
  _operation_id uuid, _station_code text, _result public.op_result,
  _note text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; op public.operations; res jsonb; code text;
BEGIN
  uid := public.assert_permission('operation.complete');
  code := upper(btrim(COALESCE(_station_code, '')));
  IF code NOT IN ('CFM', 'GRAVUR') THEN
    RAISE EXCEPTION 'GECERSIZ: Bu form yalnızca CFM ve Gravür içindir.';
  END IF;
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'op_complete_simple',
    jsonb_build_object('operation_id', _operation_id, 'station', code, 'result', _result,
      'note', NULLIF(btrim(COALESCE(_note,'')),'')));
  IF NOT cmd.is_new THEN RETURN cmd.prior::jsonb || jsonb_build_object('replayed', true); END IF;

  op := public.op_open_for_complete(_operation_id, code, uid);
  IF _result IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Sonuç zorunludur.'; END IF;

  res := public.op_close_common(_operation_id, uid, _result, _note, true);
  PERFORM public.write_audit('operation.completed', 'operations', _operation_id::text, NULL,
    jsonb_build_object('station', code, 'result', _result,
      'graphic_asset_id', op.graphic_asset_id), _note);
  PERFORM public.command_finish(_idempotency_key, res::text);
  RETURN res || jsonb_build_object('replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.op_complete_simple(uuid, text, public.op_result, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.op_complete_simple(uuid, text, public.op_result, text, text) TO authenticated, service_role;

-- 11.7 Krom: başarı üyeyi Prova İçin Hazır yapar; takım sayacı gerçek hazırlıktır.
CREATE OR REPLACE FUNCTION public.op_complete_krom(
  _operation_id uuid, _result public.op_result,
  _note text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; op public.operations; m public.team_members;
        total integer; ready integer; queued boolean := false; res jsonb;
BEGIN
  uid := public.assert_permission('operation.complete');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'op_complete_krom',
    jsonb_build_object('operation_id', _operation_id, 'result', _result,
      'note', NULLIF(btrim(COALESCE(_note,'')),'')));
  IF NOT cmd.is_new THEN RETURN cmd.prior::jsonb || jsonb_build_object('replayed', true); END IF;

  op := public.op_open_for_complete(_operation_id, 'KROM', uid);
  IF _result IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Sonuç zorunludur.'; END IF;
  SELECT * INTO m FROM public.team_members WHERE id = op.team_member_id FOR UPDATE;

  IF _result = 'basarili' AND m.proof_ready_at IS NULL THEN
    UPDATE public.team_members SET proof_ready_at = now() WHERE id = m.id;
  END IF;

  res := public.op_close_common(_operation_id, uid, _result, _note, true);

  SELECT count(*) INTO total FROM public.team_members
   WHERE team_id = m.team_id AND is_active;
  SELECT count(*) INTO ready FROM public.team_members
   WHERE team_id = m.team_id AND is_active
     AND proof_ready_at IS NOT NULL AND receipt_id IS NOT NULL;

  -- Planlanan fakat imal edilmemiş üye hazır sayılmaz.
  IF total > 0 AND ready = total THEN
    UPDATE public.teams SET proof_queued_at = COALESCE(proof_queued_at, now())
     WHERE id = m.team_id AND proof_queued_at IS NULL;
    IF FOUND THEN
      queued := true;
      PERFORM public.write_audit('team.proof_queued', 'teams', m.team_id::text, NULL,
        jsonb_build_object('ready', ready, 'total', total),
        'Takım Prova kuyruğuna girdi; bu onay veya sevkiyat değildir.');
    END IF;
  END IF;

  PERFORM public.write_audit('operation.completed', 'operations', _operation_id::text, NULL,
    jsonb_build_object('station', 'KROM', 'result', _result,
      'ready', ready, 'total', total), _note);
  res := res || jsonb_build_object('ready', ready, 'total', total, 'team_queued', queued);
  PERFORM public.command_finish(_idempotency_key, res::text);
  RETURN res || jsonb_build_object('replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.op_complete_krom(uuid, public.op_result, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.op_complete_krom(uuid, public.op_result, text, text) TO authenticated, service_role;

-- Başlatma: Gravür'de erişilebilir PDF ve kademe zorunlu; kullanılan revizyon operasyona bağlanır.
CREATE OR REPLACE FUNCTION public.op_start(
  _step_id uuid, _machine_id uuid, _qr_code text DEFAULT NULL,
  _skip_queue_reason text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
              WHERE team_member_id = m.id AND status = 'bloke') THEN
    RAISE EXCEPTION 'BLOKE: Bu silindirde açık bir bloke kaydı var.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.operations WHERE route_step_id = _step_id) THEN
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
              WHERE machine_id = _machine_id AND status = 'devam') THEN
    RAISE EXCEPTION 'MESGUL: Makinede devam eden bir iş var.';
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

-- Operatörün yalnızca kendi devam eden Gravür işinin PDF'ine erişimi.
CREATE OR REPLACE FUNCTION private.operation_graphic_grant(_actor uuid, _operation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE op public.operations; a public.graphic_assets; st public.stations;
BEGIN
  IF NOT private.has_permission_internal(_actor, 'operation.start') THEN
    RAISE EXCEPTION 'YETKISIZ: Operasyon yetkiniz yok.';
  END IF;
  SELECT * INTO op FROM public.operations WHERE id = _operation_id;
  IF op.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Operasyon yok.'; END IF;
  SELECT * INTO st FROM public.stations WHERE id = op.station_id;
  IF st.code <> 'GRAVUR' THEN
    RAISE EXCEPTION 'YETKISIZ: Bu işin grafik dosyası erişimi yok.';
  END IF;
  PERFORM public.assert_station_allowed(_actor, op.station_id);
  IF op.graphic_asset_id IS NULL THEN
    RAISE EXCEPTION 'BULUNAMADI: Bu operasyona bağlı grafik revizyonu yok.';
  END IF;
  SELECT * INTO a FROM public.graphic_assets WHERE id = op.graphic_asset_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_value, reason)
  VALUES (_actor, 'graphic_asset.operation_link', 'graphic_assets', a.id::text,
    jsonb_build_object('operation_id', op.id, 'revision_no', a.revision_no),
    'Gravür operasyonuna bağlı revizyon için erişim bağlantısı oluşturuldu');

  RETURN jsonb_build_object('storage_path', a.storage_path, 'filename', a.filename,
    'revision_no', a.revision_no);
END;
$$;

CREATE OR REPLACE FUNCTION public.srv_operation_graphic(_actor uuid, _operation_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT private.operation_graphic_grant(_actor, _operation_id); $function$;
REVOKE ALL ON FUNCTION public.srv_operation_graphic(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_operation_graphic(uuid, uuid) TO service_role;