-- Aşama 3: Depo kabulü, silindir ziyareti kaydı ve CYL kimliği.
-- Kimlik bu fabrika ziyaretine aittir; etiket tekrar basımı yeni kayıt oluşturmaz.

CREATE TYPE public.cyl_shaft_type AS ENUM ('konik', 'silindirik', 'flansli', 'diger');
CREATE TYPE public.cyl_surface_state AS ENUM ('temiz', 'bakirli', 'kromlu', 'asinmis', 'hasarli');
CREATE TYPE public.cyl_usability AS ENUM ('kullanilabilir', 'sartli', 'kullanilamaz');
CREATE TYPE public.cyl_receipt_status AS ENUM ('kabul', 'iptal');

CREATE SEQUENCE public.cylinder_code_seq;

CREATE TABLE public.cylinder_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cyl_code text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  waybill_no text,
  received_on date NOT NULL DEFAULT current_date,
  measured_circumference_mm numeric NOT NULL,
  measured_diameter_mm numeric NOT NULL,
  measured_length_mm numeric NOT NULL,
  shaft_type public.cyl_shaft_type NOT NULL,
  surface_state public.cyl_surface_state NOT NULL,
  usability public.cyl_usability NOT NULL,
  note text,
  status public.cyl_receipt_status NOT NULL DEFAULT 'kabul',
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id),
  label_print_count integer NOT NULL DEFAULT 0,
  last_label_printed_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX cylinder_receipts_customer_idx ON public.cylinder_receipts(customer_id);
CREATE INDEX cylinder_receipts_received_idx ON public.cylinder_receipts(received_on DESC);

CREATE TABLE public.cylinder_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.cylinder_receipts(id) ON DELETE CASCADE,
  circumference_mm numeric NOT NULL,
  diameter_mm numeric NOT NULL,
  length_mm numeric NOT NULL,
  source text NOT NULL DEFAULT 'kabul',
  note text,
  measured_by uuid REFERENCES auth.users(id),
  measured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cylinder_measurements_receipt_idx ON public.cylinder_measurements(receipt_id, measured_at DESC);

GRANT SELECT ON public.cylinder_receipts TO authenticated;
GRANT ALL ON public.cylinder_receipts TO service_role;
GRANT SELECT ON public.cylinder_measurements TO authenticated;
GRANT ALL ON public.cylinder_measurements TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cylinder_code_seq TO service_role;

CREATE OR REPLACE FUNCTION public.can_read_inventory()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user(auth.uid()) AND (
    public.has_permission(auth.uid(), 'inventory.receive')
    OR public.has_permission(auth.uid(), 'inventory.correct_unassigned')
    OR public.has_permission(auth.uid(), 'team.manage')
    OR public.has_permission(auth.uid(), 'production.release')
    OR public.has_permission(auth.uid(), 'audit.read')
  );
$$;
REVOKE ALL ON FUNCTION public.can_read_inventory() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_read_inventory() TO authenticated, service_role;

ALTER TABLE public.cylinder_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cylinder_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cylinder_receipts_select" ON public.cylinder_receipts
  FOR SELECT TO authenticated USING (public.can_read_inventory());
CREATE POLICY "cylinder_measurements_select" ON public.cylinder_measurements
  FOR SELECT TO authenticated USING (public.can_read_inventory());

CREATE TRIGGER cylinder_receipts_updated_at BEFORE UPDATE ON public.cylinder_receipts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Kabul kaydı yaratma
CREATE OR REPLACE FUNCTION public.receive_cylinder(
  _customer_id uuid,
  _measured_circumference_mm numeric,
  _measured_diameter_mm numeric,
  _measured_length_mm numeric,
  _shaft_type public.cyl_shaft_type,
  _surface_state public.cyl_surface_state,
  _usability public.cyl_usability,
  _waybill_no text DEFAULT NULL,
  _received_on date DEFAULT current_date,
  _note text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; cust public.customers; new_id uuid; code text;
BEGIN
  uid := public.assert_permission('inventory.receive');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'receive_cylinder',
    jsonb_build_object(
      'customer_id', _customer_id,
      'circumference', _measured_circumference_mm,
      'diameter', _measured_diameter_mm,
      'length', _measured_length_mm,
      'shaft_type', _shaft_type,
      'surface_state', _surface_state,
      'usability', _usability,
      'waybill_no', NULLIF(btrim(COALESCE(_waybill_no,'')),''),
      'received_on', COALESCE(_received_on, current_date),
      'note', NULLIF(btrim(COALESCE(_note,'')),'')));
  IF NOT cmd.is_new THEN
    SELECT jsonb_build_object('id', r.id, 'cyl_code', r.cyl_code, 'replayed', true)
      INTO cmd.prior FROM public.cylinder_receipts r WHERE r.id = cmd.prior::uuid;
    RETURN cmd.prior::jsonb;
  END IF;

  SELECT * INTO cust FROM public.customers WHERE id = _customer_id;
  IF cust.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Müşteri yok.'; END IF;
  IF NOT cust.is_active THEN RAISE EXCEPTION 'MUSTERI_PASIF: Pasif müşteri adına kabul yapılamaz.'; END IF;
  IF _measured_circumference_mm IS NULL OR _measured_circumference_mm <= 0
     OR _measured_diameter_mm IS NULL OR _measured_diameter_mm <= 0
     OR _measured_length_mm IS NULL OR _measured_length_mm <= 0 THEN
    RAISE EXCEPTION 'GECERSIZ: Ölçülen çevre, çap ve boy pozitif olmalıdır.';
  END IF;

  code := 'CYL-' || to_char(COALESCE(_received_on, current_date), 'YYYY') || '-' ||
          lpad(nextval('public.cylinder_code_seq')::text, 5, '0');

  INSERT INTO public.cylinder_receipts (cyl_code, customer_id, waybill_no, received_on,
    measured_circumference_mm, measured_diameter_mm, measured_length_mm,
    shaft_type, surface_state, usability, note, created_by, updated_by)
  VALUES (code, _customer_id, NULLIF(btrim(COALESCE(_waybill_no,'')),''),
    COALESCE(_received_on, current_date),
    _measured_circumference_mm, _measured_diameter_mm, _measured_length_mm,
    _shaft_type, _surface_state, _usability,
    NULLIF(btrim(COALESCE(_note,'')),''), uid, uid)
  RETURNING id INTO new_id;

  INSERT INTO public.cylinder_measurements (receipt_id, circumference_mm, diameter_mm, length_mm,
    source, note, measured_by)
  VALUES (new_id, _measured_circumference_mm, _measured_diameter_mm, _measured_length_mm,
    'kabul', NULLIF(btrim(COALESCE(_note,'')),''), uid);

  PERFORM public.write_audit('cylinder.received', 'cylinder_receipts', new_id::text, NULL,
    jsonb_build_object('cyl_code', code, 'customer_id', _customer_id,
      'circumference', _measured_circumference_mm, 'diameter', _measured_diameter_mm,
      'length', _measured_length_mm), NULL);
  PERFORM public.command_finish(_idempotency_key, new_id::text);

  RETURN jsonb_build_object('id', new_id, 'cyl_code', code, 'replayed', false);
END;
$$;

-- Kabul kaydını düzeltme: bağlanmamış kayıt, kendi kaydı veya geniş yetki
CREATE OR REPLACE FUNCTION public.update_cylinder_receipt(
  _receipt_id uuid,
  _row_version integer,
  _measured_circumference_mm numeric,
  _measured_diameter_mm numeric,
  _measured_length_mm numeric,
  _shaft_type public.cyl_shaft_type,
  _surface_state public.cyl_surface_state,
  _usability public.cyl_usability,
  _waybill_no text DEFAULT NULL,
  _note text DEFAULT NULL,
  _reason text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; old_row public.cylinder_receipts; new_row public.cylinder_receipts;
BEGIN
  uid := public.assert_permission('inventory.correct_unassigned');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'update_cylinder_receipt',
    jsonb_build_object(
      'receipt_id', _receipt_id, 'row_version', _row_version,
      'circumference', _measured_circumference_mm,
      'diameter', _measured_diameter_mm,
      'length', _measured_length_mm,
      'shaft_type', _shaft_type, 'surface_state', _surface_state, 'usability', _usability,
      'waybill_no', NULLIF(btrim(COALESCE(_waybill_no,'')),''),
      'note', NULLIF(btrim(COALESCE(_note,'')),''),
      'reason', NULLIF(btrim(COALESCE(_reason,'')),'')));
  IF NOT cmd.is_new THEN RETURN cmd.prior::integer; END IF;

  SELECT * INTO old_row FROM public.cylinder_receipts WHERE id = _receipt_id FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Silindir kaydı yok.'; END IF;
  IF old_row.status = 'iptal' THEN RAISE EXCEPTION 'IPTAL_EDILMIS: İptal edilmiş kayıt değiştirilemez.'; END IF;
  IF old_row.created_by IS DISTINCT FROM uid AND NOT public.has_permission(uid, 'team.manage') THEN
    RAISE EXCEPTION 'YETKISIZ: Yalnızca kendi kabul kaydınızı düzeltebilirsiniz.';
  END IF;
  PERFORM public.assert_row_version(_row_version, old_row.row_version);
  IF _measured_circumference_mm IS NULL OR _measured_circumference_mm <= 0
     OR _measured_diameter_mm IS NULL OR _measured_diameter_mm <= 0
     OR _measured_length_mm IS NULL OR _measured_length_mm <= 0 THEN
    RAISE EXCEPTION 'GECERSIZ: Ölçülen çevre, çap ve boy pozitif olmalıdır.';
  END IF;

  UPDATE public.cylinder_receipts SET
    measured_circumference_mm = _measured_circumference_mm,
    measured_diameter_mm = _measured_diameter_mm,
    measured_length_mm = _measured_length_mm,
    shaft_type = _shaft_type,
    surface_state = _surface_state,
    usability = _usability,
    waybill_no = NULLIF(btrim(COALESCE(_waybill_no,'')),''),
    note = NULLIF(btrim(COALESCE(_note,'')),''),
    row_version = old_row.row_version + 1,
    updated_by = uid
  WHERE id = _receipt_id
  RETURNING * INTO new_row;

  IF (old_row.measured_circumference_mm, old_row.measured_diameter_mm, old_row.measured_length_mm)
     IS DISTINCT FROM (_measured_circumference_mm, _measured_diameter_mm, _measured_length_mm) THEN
    INSERT INTO public.cylinder_measurements (receipt_id, circumference_mm, diameter_mm, length_mm,
      source, note, measured_by)
    VALUES (_receipt_id, _measured_circumference_mm, _measured_diameter_mm, _measured_length_mm,
      'duzeltme', NULLIF(btrim(COALESCE(_reason,'')),''), uid);
  END IF;

  PERFORM public.write_audit('cylinder.updated', 'cylinder_receipts', _receipt_id::text,
    to_jsonb(old_row), to_jsonb(new_row), _reason);
  PERFORM public.command_finish(_idempotency_key, new_row.row_version::text);
  RETURN new_row.row_version;
END;
$$;

-- Hatalı kayıt silinmez; gerekçeyle iptal edilir.
CREATE OR REPLACE FUNCTION public.cancel_cylinder_receipt(
  _receipt_id uuid, _row_version integer, _reason text, _idempotency_key text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; old_row public.cylinder_receipts; new_version integer;
BEGIN
  uid := public.assert_permission('inventory.correct_unassigned');
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'GECERSIZ: İptal gerekçesi zorunludur.';
  END IF;
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'cancel_cylinder_receipt',
    jsonb_build_object('receipt_id', _receipt_id, 'row_version', _row_version,
      'reason', btrim(_reason)));
  IF NOT cmd.is_new THEN RETURN cmd.prior::integer; END IF;

  SELECT * INTO old_row FROM public.cylinder_receipts WHERE id = _receipt_id FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Silindir kaydı yok.'; END IF;
  IF old_row.status = 'iptal' THEN RAISE EXCEPTION 'IPTAL_EDILMIS: Kayıt zaten iptal edilmiş.'; END IF;
  IF old_row.created_by IS DISTINCT FROM uid AND NOT public.has_permission(uid, 'team.manage') THEN
    RAISE EXCEPTION 'YETKISIZ: Yalnızca kendi kabul kaydınızı iptal edebilirsiniz.';
  END IF;
  PERFORM public.assert_row_version(_row_version, old_row.row_version);

  UPDATE public.cylinder_receipts SET
    status = 'iptal', cancel_reason = btrim(_reason), cancelled_at = now(), cancelled_by = uid,
    row_version = old_row.row_version + 1, updated_by = uid
  WHERE id = _receipt_id
  RETURNING row_version INTO new_version;

  PERFORM public.write_audit('cylinder.cancelled', 'cylinder_receipts', _receipt_id::text,
    to_jsonb(old_row), jsonb_build_object('status', 'iptal'), btrim(_reason));
  PERFORM public.command_finish(_idempotency_key, new_version::text);
  RETURN new_version;
END;
$$;

-- Etiket tekrar basımı: yeni silindir kaydı OLUŞTURMAZ, yalnızca sayaç ve denetim.
CREATE OR REPLACE FUNCTION public.record_label_print(_receipt_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cnt integer;
BEGIN
  uid := public.assert_permission('inventory.receive');
  UPDATE public.cylinder_receipts
     SET label_print_count = label_print_count + 1, last_label_printed_at = now()
   WHERE id = _receipt_id
  RETURNING label_print_count INTO cnt;
  IF cnt IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Silindir kaydı yok.'; END IF;
  PERFORM public.write_audit('cylinder.label_printed', 'cylinder_receipts', _receipt_id::text,
    NULL, jsonb_build_object('label_print_count', cnt), NULL);
  RETURN cnt;
END;
$$;

REVOKE ALL ON FUNCTION public.receive_cylinder(uuid, numeric, numeric, numeric, public.cyl_shaft_type, public.cyl_surface_state, public.cyl_usability, text, date, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.receive_cylinder(uuid, numeric, numeric, numeric, public.cyl_shaft_type, public.cyl_surface_state, public.cyl_usability, text, date, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_cylinder_receipt(uuid, integer, numeric, numeric, numeric, public.cyl_shaft_type, public.cyl_surface_state, public.cyl_usability, text, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_cylinder_receipt(uuid, integer, numeric, numeric, numeric, public.cyl_shaft_type, public.cyl_surface_state, public.cyl_usability, text, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cancel_cylinder_receipt(uuid, integer, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_cylinder_receipt(uuid, integer, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_label_print(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_label_print(uuid) TO authenticated, service_role;