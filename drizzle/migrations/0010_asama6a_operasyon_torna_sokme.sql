-- Aşama 6A: operatör operasyonu (başlat/tamamla), not-uyarı-bloke,
-- Torna ve tekil D-Krom/Sökme tamamlama. QR okutmak süre başlatmaz.

CREATE TYPE public.op_status AS ENUM ('devam', 'tamamlandi', 'bloke');
CREATE TYPE public.op_result AS ENUM ('basarili', 'sorunlu');
CREATE TYPE public.op_work AS ENUM (
  'yeni_imalat','cevre_dusurme','cevre_yukseltme','mil_cakma','yuzuk_degisimi','tamir'
);
CREATE TYPE public.op_note_kind AS ENUM ('not', 'uyari', 'bloke');

CREATE TABLE public.operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  route_step_id uuid NOT NULL UNIQUE REFERENCES public.route_steps(id),
  station_id uuid NOT NULL REFERENCES public.stations(id),
  machine_id uuid NOT NULL REFERENCES public.machines(id),
  op_label text NOT NULL,
  round_no integer NOT NULL DEFAULT 1,
  status public.op_status NOT NULL DEFAULT 'devam',
  result public.op_result,
  performed_works public.op_work[] NOT NULL DEFAULT '{}',
  skip_queue_reason text,
  note text,
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid REFERENCES auth.users(id),
  finished_at timestamptz,
  finished_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operations_member_idx ON public.operations(team_member_id);
CREATE INDEX operations_machine_busy_idx ON public.operations(machine_id) WHERE status = 'devam';

CREATE TABLE public.operation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid REFERENCES public.operations(id),
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  receipt_id uuid REFERENCES public.cylinder_receipts(id),
  kind public.op_note_kind NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id)
);
CREATE INDEX operation_notes_member_idx ON public.operation_notes(team_member_id);

GRANT SELECT ON public.operations TO authenticated;
GRANT SELECT ON public.operation_notes TO authenticated;
GRANT ALL ON public.operations TO service_role;
GRANT ALL ON public.operation_notes TO service_role;

ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operations_select" ON public.operations
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));
CREATE POLICY "operation_notes_select" ON public.operation_notes
  FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));

-- İstasyon yetkisi: Admin dışında kullanıcı yalnızca kapsamındaki istasyonda çalışır.
CREATE OR REPLACE FUNCTION public.assert_station_allowed(_uid uuid, _station_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_admin(_uid) THEN RETURN; END IF;
  IF NOT public.has_station_scope(_uid, _station_id) THEN
    RAISE EXCEPTION 'YETKISIZ: Bu istasyonda işlem yetkiniz yok.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_station_allowed(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assert_station_allowed(uuid, uuid) TO authenticated, service_role;

-- Başlatma. QR/kod eşleşmesi fiziksel silindirde zorunlu; yeni imalat istisnadır.
CREATE OR REPLACE FUNCTION public.op_start(
  _step_id uuid, _machine_id uuid, _qr_code text DEFAULT NULL,
  _skip_queue_reason text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; step public.route_steps; plan public.route_plans;
        m public.team_members; rec public.cylinder_receipts; mach public.machines;
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
    op_label, round_no, started_by, skip_queue_reason)
  VALUES (m.id, _step_id, step.station_id, _machine_id, step.op_label, step.round_no, uid,
    NULLIF(btrim(COALESCE(_skip_queue_reason,'')),''))
  RETURNING id INTO op_id;

  PERFORM public.write_audit('operation.started', 'operations', op_id::text, NULL,
    jsonb_build_object('member_id', m.id, 'step_id', _step_id, 'station_id', step.station_id,
      'machine_id', _machine_id, 'op_label', step.op_label), _skip_queue_reason);
  PERFORM public.command_finish(_idempotency_key, op_id::text);
  RETURN jsonb_build_object('operation_id', op_id, 'replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.op_start(uuid, uuid, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.op_start(uuid, uuid, text, text, text) TO authenticated, service_role;

-- Ortak kapanış: adımı kapat, başarıda YALNIZCA sonraki gerekli adımı kuyruğa al.
CREATE OR REPLACE FUNCTION public.op_close_common(
  _op_id uuid, _uid uuid, _result public.op_result, _note text, _auto_queue boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE op public.operations; step public.route_steps; nxt public.route_steps;
        m public.team_members; queued jsonb := NULL;
BEGIN
  SELECT * INTO op FROM public.operations WHERE id = _op_id;
  SELECT * INTO step FROM public.route_steps WHERE id = op.route_step_id FOR UPDATE;
  SELECT * INTO m FROM public.team_members WHERE id = op.team_member_id FOR UPDATE;

  IF _result = 'basarili' THEN
    UPDATE public.operations SET status = 'tamamlandi', result = 'basarili',
      finished_at = now(), finished_by = _uid,
      note = NULLIF(btrim(COALESCE(_note,'')),'') WHERE id = _op_id;
    UPDATE public.route_steps SET status = 'tamamlandi' WHERE id = step.id;

    IF _auto_queue THEN
      SELECT * INTO nxt FROM public.route_steps
       WHERE plan_id = step.plan_id AND status = 'planlandi' AND seq > step.seq
       ORDER BY seq LIMIT 1 FOR UPDATE;
      IF nxt.id IS NOT NULL THEN
        UPDATE public.route_steps SET status = 'kuyrukta', queued_at = now() WHERE id = nxt.id;
        queued := jsonb_build_object('step_id', nxt.id, 'op_label', nxt.op_label,
                                     'station_id', nxt.station_id);
      END IF;
    END IF;
  ELSE
    UPDATE public.operations SET status = 'bloke', result = 'sorunlu',
      finished_at = now(), finished_by = _uid,
      note = NULLIF(btrim(COALESCE(_note,'')),'') WHERE id = _op_id;
    INSERT INTO public.operation_notes (operation_id, team_member_id, receipt_id, kind, body, created_by)
    VALUES (_op_id, m.id, m.receipt_id, 'bloke',
      COALESCE(NULLIF(btrim(COALESCE(_note,'')),''), 'Sorunlu sonuç bildirildi.'), _uid);
  END IF;

  RETURN jsonb_build_object('operation_id', _op_id, 'result', _result, 'next_queued', queued);
END;
$$;
REVOKE ALL ON FUNCTION public.op_close_common(uuid, uuid, public.op_result, text, boolean) FROM public, anon, authenticated;

-- Torna tamamlama. Yapılan iş/işler ve sonuç zorunlu.
CREATE OR REPLACE FUNCTION public.op_complete_torna(
  _operation_id uuid, _result public.op_result, _works public.op_work[],
  _note text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; op public.operations; st public.stations;
        m public.team_members; ord public.orders; new_id uuid; code text;
        res jsonb; works public.op_work[];
BEGIN
  uid := public.assert_permission('operation.complete');
  works := COALESCE(_works, '{}'::public.op_work[]);
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'op_complete_torna',
    jsonb_build_object('operation_id', _operation_id, 'result', _result,
      'works', to_jsonb(works), 'note', NULLIF(btrim(COALESCE(_note,'')),'')));
  IF NOT cmd.is_new THEN RETURN cmd.prior::jsonb || jsonb_build_object('replayed', true); END IF;

  SELECT * INTO op FROM public.operations WHERE id = _operation_id FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Operasyon yok.'; END IF;
  IF op.status <> 'devam' THEN
    RAISE EXCEPTION 'GECERSIZ: Operasyon devam etmiyor (%). Tamamlanan kayıt değiştirilemez.', op.status;
  END IF;
  SELECT * INTO st FROM public.stations WHERE id = op.station_id;
  IF st.code <> 'TORNA' THEN RAISE EXCEPTION 'GECERSIZ: Bu form yalnızca Torna içindir.'; END IF;
  PERFORM public.assert_station_allowed(uid, op.station_id);
  IF _result IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Sonuç zorunludur.'; END IF;
  IF array_length(works, 1) IS NULL THEN
    RAISE EXCEPTION 'GECERSIZ: Yapılan iş/işler zorunludur.';
  END IF;

  SELECT * INTO m FROM public.team_members WHERE id = op.team_member_id FOR UPDATE;
  UPDATE public.operations SET performed_works = works WHERE id = _operation_id;

  -- Yeni imalat: tek gerçek CYL kaydı ve QR. Aşağı akış otomatik başlamaz.
  IF m.kind = 'yeni_imalat' AND m.receipt_id IS NULL AND _result = 'basarili' THEN
    SELECT o.* INTO ord FROM public.orders o
      JOIN public.teams t ON t.order_id = o.id WHERE t.id = m.team_id;
    code := 'CYL-' || to_char(current_date, 'YYYY') || '-' ||
            lpad(nextval('public.cylinder_code_seq')::text, 5, '0');
    INSERT INTO public.cylinder_receipts (cyl_code, customer_id, received_on,
      shaft_type, surface_state, usability, lifecycle, origin, measurements_recorded,
      nominal_circumference_mm, nominal_length_mm, note, created_by, updated_by)
    VALUES (code, ord.customer_id, current_date,
      'diger', 'temiz', 'kullanilabilir', 'uretimde', 'yeni_imalat', false,
      ord.nominal_circumference_mm, ord.target_length_mm,
      'Torna yeni imalatında oluşturuldu. Ölçüm kaydı yok.', uid, uid)
    RETURNING id INTO new_id;
    UPDATE public.team_members SET receipt_id = new_id WHERE id = m.id;
    PERFORM public.write_audit('cylinder.manufactured', 'cylinder_receipts', new_id::text, NULL,
      jsonb_build_object('cyl_code', code, 'member_id', m.id, 'order_id', ord.id), NULL);
  END IF;

  -- Mevcut silindirde başarı sonraki adımı kuyruğa alır; yeni imalatta alınmaz.
  res := public.op_close_common(_operation_id, uid, _result, _note,
                                (m.kind = 'mevcut'));
  IF m.kind = 'yeni_imalat' AND _result = 'basarili' THEN
    UPDATE public.team_members SET released_at = NULL, released_by = NULL WHERE id = m.id;
  END IF;

  res := res || jsonb_build_object('cyl_code', code, 'receipt_id', new_id,
    'awaiting_release', (m.kind = 'yeni_imalat' AND _result = 'basarili'));
  PERFORM public.write_audit('operation.completed', 'operations', _operation_id::text, NULL,
    jsonb_build_object('station', 'TORNA', 'result', _result, 'works', to_jsonb(works)), _note);
  PERFORM public.command_finish(_idempotency_key, res::text);
  RETURN res || jsonb_build_object('replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.op_complete_torna(uuid, public.op_result, public.op_work[], text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.op_complete_torna(uuid, public.op_result, public.op_work[], text, text) TO authenticated, service_role;

-- Tekil D-Krom / Sökme tamamlama. Sonuç zorunlu, ölçüm zorunlu değil.
CREATE OR REPLACE FUNCTION public.op_complete_sokme(
  _operation_id uuid, _result public.op_result,
  _note text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; op public.operations; st public.stations; res jsonb;
BEGIN
  uid := public.assert_permission('operation.complete');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'op_complete_sokme',
    jsonb_build_object('operation_id', _operation_id, 'result', _result,
      'note', NULLIF(btrim(COALESCE(_note,'')),'')));
  IF NOT cmd.is_new THEN RETURN cmd.prior::jsonb || jsonb_build_object('replayed', true); END IF;

  SELECT * INTO op FROM public.operations WHERE id = _operation_id FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Operasyon yok.'; END IF;
  IF op.status <> 'devam' THEN
    RAISE EXCEPTION 'GECERSIZ: Operasyon devam etmiyor (%). Tamamlanan kayıt değiştirilemez.', op.status;
  END IF;
  SELECT * INTO st FROM public.stations WHERE id = op.station_id;
  IF st.code <> 'SOKME' THEN
    RAISE EXCEPTION 'GECERSIZ: Bu form yalnızca D-Krom / Sökme içindir.';
  END IF;
  PERFORM public.assert_station_allowed(uid, op.station_id);
  IF _result IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Sonuç zorunludur.'; END IF;

  res := public.op_close_common(_operation_id, uid, _result, _note, true);
  PERFORM public.write_audit('operation.completed', 'operations', _operation_id::text, NULL,
    jsonb_build_object('station', 'SOKME', 'result', _result), _note);
  PERFORM public.command_finish(_idempotency_key, res::text);
  RETURN res || jsonb_build_object('replayed', false);
END;
$$;
REVOKE ALL ON FUNCTION public.op_complete_sokme(uuid, public.op_result, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.op_complete_sokme(uuid, public.op_result, text, text) TO authenticated, service_role;

-- Not / uyarı / bloke. Uyarı işi otomatik bloke etmez.
CREATE OR REPLACE FUNCTION public.op_add_note(
  _operation_id uuid, _kind public.op_note_kind, _body text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; op public.operations; m public.team_members; note_id uuid;
BEGIN
  uid := public.assert_permission('quality.request');
  SELECT * INTO op FROM public.operations WHERE id = _operation_id FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Operasyon yok.'; END IF;
  PERFORM public.assert_station_allowed(uid, op.station_id);
  IF NULLIF(btrim(COALESCE(_body,'')),'') IS NULL THEN
    RAISE EXCEPTION 'GECERSIZ: Açıklama zorunludur.';
  END IF;
  SELECT * INTO m FROM public.team_members WHERE id = op.team_member_id;

  INSERT INTO public.operation_notes (operation_id, team_member_id, receipt_id, kind, body, created_by)
  VALUES (_operation_id, m.id, m.receipt_id, _kind, btrim(_body), uid)
  RETURNING id INTO note_id;

  IF _kind = 'bloke' THEN
    IF op.status = 'tamamlandi' THEN
      RAISE EXCEPTION 'GECERSIZ: Tamamlanmış operasyon bloke edilemez.';
    END IF;
    UPDATE public.operations SET status = 'bloke' WHERE id = _operation_id;
  END IF;

  PERFORM public.write_audit('operation.note_added', 'operation_notes', note_id::text, NULL,
    jsonb_build_object('operation_id', _operation_id, 'kind', _kind, 'body', btrim(_body)), NULL);
  RETURN note_id;
END;
$$;
REVOKE ALL ON FUNCTION public.op_add_note(uuid, public.op_note_kind, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.op_add_note(uuid, public.op_note_kind, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.op_ack_note(_note_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  uid := public.assert_permission('quality.request');
  UPDATE public.operation_notes
     SET acknowledged_at = now(), acknowledged_by = uid
   WHERE id = _note_id AND acknowledged_at IS NULL;
  PERFORM public.write_audit('operation.note_acked', 'operation_notes', _note_id::text,
    NULL, NULL, NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.op_ack_note(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.op_ack_note(uuid) TO authenticated, service_role;