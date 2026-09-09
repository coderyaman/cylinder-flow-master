-- ============ Aşama 2: Müşteri, sipariş ve grafik ============

-- 1) Yeni yetki: grafik dosyasını indirme
INSERT INTO public.permissions (code, label, category)
VALUES ('orders.read_graphic_file', 'Grafik PDF dosyasını görüntüleme', 'Sipariş')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_code)
SELECT r, 'orders.read_graphic_file'
FROM unnest(ARRAY['grafik','asistan','mudur','admin']::public.app_role[]) AS r
ON CONFLICT DO NOTHING;

-- 2) Enum'lar
CREATE TYPE public.graphic_status AS ENUM
  ('dosya_bekleniyor','renk_ayrimi','musteri_onayi','revize','grafik_hazir');
CREATE TYPE public.supply_status AS ENUM
  ('belirsiz','depoda_mevcut','silindir_bekleniyor','yeni_imalat','kismi');
CREATE TYPE public.order_priority AS ENUM ('normal','yuksek','acil');
CREATE TYPE public.order_closure_status AS ENUM ('acik','iptal');

-- 3) Yardımcı yetki fonksiyonları
CREATE OR REPLACE FUNCTION public.can_read_orders()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = auth.uid()
      AND p.is_active
      AND ur.role <> 'operator'
  );
$$;

CREATE OR REPLACE FUNCTION public.assert_permission(_permission text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'YETKISIZ: Oturum bulunamadı.'; END IF;
  IF NOT public.is_active_user(uid) THEN RAISE EXCEPTION 'PASIF_HESAP: Hesabınız pasif durumda.'; END IF;
  IF NOT public.has_permission(uid, _permission) THEN
    RAISE EXCEPTION 'YETKISIZ: Bu işlem için % izni gerekir.', _permission;
  END IF;
  RETURN uid;
END;
$$;

-- 4) Tekrar gönderilen istekler
CREATE TABLE public.command_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  command text NOT NULL,
  actor_id uuid REFERENCES auth.users,
  result_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.command_log TO service_role;
ALTER TABLE public.command_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.command_begin(_key text, _command text)
RETURNS TABLE (is_new boolean, prior text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing text; inserted boolean := false;
BEGIN
  IF _key IS NULL OR btrim(_key) = '' THEN
    RETURN QUERY SELECT true, NULL::text; RETURN;
  END IF;
  INSERT INTO public.command_log (idempotency_key, command, actor_id)
  VALUES (_key, _command, auth.uid())
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted THEN RETURN QUERY SELECT true, NULL::text; RETURN; END IF;
  SELECT result_ref INTO existing FROM public.command_log WHERE idempotency_key = _key;
  IF existing IS NULL THEN
    RAISE EXCEPTION 'ISLEM_DEVAM: Aynı istek halen işleniyor, lütfen bekleyin.';
  END IF;
  RETURN QUERY SELECT false, existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.command_finish(_key text, _result text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _key IS NULL OR btrim(_key) = '' THEN RETURN; END IF;
  UPDATE public.command_log SET result_ref = _result WHERE idempotency_key = _key;
END;
$$;

-- 5) Müşteriler
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (lower(btrim(name))) STORED,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users
);
CREATE INDEX customers_normalized_name_idx ON public.customers (normalized_name);
GRANT SELECT ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_select ON public.customers
  FOR SELECT TO authenticated USING (public.can_read_orders());
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6) Siparişler
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  work_order_no text NOT NULL,
  normalized_work_order_no text GENERATED ALWAYS AS (btrim(work_order_no)) STORED,
  name text NOT NULL,
  quantity integer NOT NULL,
  nominal_circumference_mm numeric(10,2) NOT NULL,
  target_length_mm numeric(10,2) NOT NULL,
  ordered_on date NOT NULL DEFAULT current_date,
  due_on date NOT NULL,
  graphic_status public.graphic_status NOT NULL DEFAULT 'dosya_bekleniyor',
  supply_status public.supply_status NOT NULL DEFAULT 'belirsiz',
  priority public.order_priority NOT NULL DEFAULT 'normal',
  note text,
  critical_note text,
  closure_status public.order_closure_status NOT NULL DEFAULT 'acik',
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users,
  CONSTRAINT orders_quantity_pozitif CHECK (quantity > 0),
  CONSTRAINT orders_cevre_pozitif CHECK (nominal_circumference_mm > 0),
  CONSTRAINT orders_boy_pozitif CHECK (target_length_mm > 0),
  CONSTRAINT orders_is_emri_dolu CHECK (btrim(work_order_no) <> ''),
  CONSTRAINT orders_ad_dolu CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX orders_customer_work_order_uk
  ON public.orders (customer_id, normalized_work_order_no);
CREATE INDEX orders_due_on_idx ON public.orders (due_on);
GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated USING (public.can_read_orders());
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7) Grafik PDF revizyonları
CREATE TABLE public.graphic_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  revision_no integer NOT NULL,
  storage_path text NOT NULL UNIQUE,
  filename text NOT NULL,
  byte_size bigint NOT NULL,
  content_type text NOT NULL,
  checksum text,
  is_current boolean NOT NULL DEFAULT true,
  uploaded_by uuid REFERENCES auth.users,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT graphic_assets_boyut CHECK (byte_size > 0 AND byte_size <= 52428800),
  CONSTRAINT graphic_assets_tur CHECK (content_type = 'application/pdf')
);
CREATE UNIQUE INDEX graphic_assets_order_revision_uk
  ON public.graphic_assets (order_id, revision_no);
CREATE UNIQUE INDEX graphic_assets_current_uk
  ON public.graphic_assets (order_id) WHERE is_current;
GRANT SELECT ON public.graphic_assets TO authenticated;
GRANT ALL ON public.graphic_assets TO service_role;
ALTER TABLE public.graphic_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY graphic_assets_select ON public.graphic_assets
  FOR SELECT TO authenticated USING (public.can_read_orders());

-- 8) Müşteri yönetimi RPC'leri
CREATE OR REPLACE FUNCTION public.admin_create_customer(_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid; nm text := btrim(_name);
BEGIN
  PERFORM public.assert_admin_caller();
  IF nm = '' THEN RAISE EXCEPTION 'GECERSIZ: Firma adı gerekli.'; END IF;
  INSERT INTO public.customers (name, created_by, updated_by)
  VALUES (nm, auth.uid(), auth.uid()) RETURNING id INTO new_id;
  PERFORM public.write_audit('customer.created', 'customers', new_id::text, NULL,
    jsonb_build_object('name', nm), NULL);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_customer(_customer_id uuid, _name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_row public.customers; nm text := btrim(_name);
BEGIN
  PERFORM public.assert_admin_caller();
  IF nm = '' THEN RAISE EXCEPTION 'GECERSIZ: Firma adı gerekli.'; END IF;
  SELECT * INTO old_row FROM public.customers WHERE id = _customer_id;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Müşteri yok.'; END IF;
  UPDATE public.customers SET name = nm, updated_by = auth.uid() WHERE id = _customer_id;
  PERFORM public.write_audit('customer.updated', 'customers', _customer_id::text,
    jsonb_build_object('name', old_row.name), jsonb_build_object('name', nm), NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_customer_active(_customer_id uuid, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_active boolean;
BEGIN
  PERFORM public.assert_admin_caller();
  SELECT is_active INTO old_active FROM public.customers WHERE id = _customer_id;
  IF old_active IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Müşteri yok.'; END IF;
  UPDATE public.customers SET is_active = _active, updated_by = auth.uid() WHERE id = _customer_id;
  PERFORM public.write_audit('customer.active_changed', 'customers', _customer_id::text,
    jsonb_build_object('is_active', old_active), jsonb_build_object('is_active', _active), NULL);
END;
$$;

-- 9) Sipariş RPC'leri
CREATE OR REPLACE FUNCTION public.create_order(
  _customer_id uuid,
  _work_order_no text,
  _name text,
  _quantity integer,
  _nominal_circumference_mm numeric,
  _target_length_mm numeric,
  _due_on date,
  _ordered_on date DEFAULT current_date,
  _supply_status public.supply_status DEFAULT 'belirsiz',
  _priority public.order_priority DEFAULT 'normal',
  _note text DEFAULT NULL,
  _critical_note text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid; cmd record; cust public.customers;
BEGIN
  PERFORM public.assert_permission('orders.create');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'create_order');
  IF NOT cmd.is_new THEN RETURN cmd.prior::uuid; END IF;

  SELECT * INTO cust FROM public.customers WHERE id = _customer_id;
  IF cust.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Müşteri yok.'; END IF;
  IF NOT cust.is_active THEN RAISE EXCEPTION 'MUSTERI_PASIF: Pasif müşteriye sipariş açılamaz.'; END IF;
  IF _due_on IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Termin tarihi zorunludur.'; END IF;
  IF _quantity IS NULL OR _quantity <= 0 THEN RAISE EXCEPTION 'GECERSIZ: Silindir adedi pozitif olmalıdır.'; END IF;

  BEGIN
    INSERT INTO public.orders (customer_id, work_order_no, name, quantity,
      nominal_circumference_mm, target_length_mm, ordered_on, due_on,
      supply_status, priority, note, critical_note, created_by, updated_by)
    VALUES (_customer_id, _work_order_no, btrim(_name), _quantity,
      _nominal_circumference_mm, _target_length_mm, COALESCE(_ordered_on, current_date), _due_on,
      _supply_status, _priority, NULLIF(btrim(COALESCE(_note,'')),''),
      NULLIF(btrim(COALESCE(_critical_note,'')),''), auth.uid(), auth.uid())
    RETURNING id INTO new_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'IS_EMRI_TEKRAR: Bu müşteride aynı iş emri numarası zaten var.';
  END;

  PERFORM public.write_audit('order.created', 'orders', new_id::text, NULL,
    jsonb_build_object('customer_id', _customer_id, 'work_order_no', btrim(_work_order_no),
      'quantity', _quantity, 'due_on', _due_on), NULL);
  PERFORM public.command_finish(_idempotency_key, new_id::text);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order(
  _order_id uuid,
  _row_version integer,
  _work_order_no text,
  _name text,
  _quantity integer,
  _nominal_circumference_mm numeric,
  _target_length_mm numeric,
  _due_on date,
  _supply_status public.supply_status,
  _priority public.order_priority,
  _note text DEFAULT NULL,
  _critical_note text DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_row public.orders; new_row public.orders;
BEGIN
  PERFORM public.assert_permission('orders.create');
  SELECT * INTO old_row FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sipariş yok.'; END IF;
  IF old_row.closure_status = 'iptal' THEN
    RAISE EXCEPTION 'IPTAL_EDILMIS: İptal edilmiş sipariş değiştirilemez.';
  END IF;
  IF old_row.row_version <> _row_version THEN
    RAISE EXCEPTION 'SURUM_ESKI: Kayıt siz açtıktan sonra değişti. Güncel hâli yükleyip yeniden deneyin.';
  END IF;
  IF _due_on IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Termin tarihi zorunludur.'; END IF;

  BEGIN
    UPDATE public.orders SET
      work_order_no = _work_order_no,
      name = btrim(_name),
      quantity = _quantity,
      nominal_circumference_mm = _nominal_circumference_mm,
      target_length_mm = _target_length_mm,
      due_on = _due_on,
      supply_status = _supply_status,
      priority = _priority,
      note = NULLIF(btrim(COALESCE(_note,'')),''),
      critical_note = NULLIF(btrim(COALESCE(_critical_note,'')),''),
      row_version = old_row.row_version + 1,
      updated_by = auth.uid()
    WHERE id = _order_id
    RETURNING * INTO new_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'IS_EMRI_TEKRAR: Bu müşteride aynı iş emri numarası zaten var.';
  END;

  PERFORM public.write_audit('order.updated', 'orders', _order_id::text,
    to_jsonb(old_row), to_jsonb(new_row), _reason);
  RETURN new_row.row_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_order(
  _order_id uuid, _row_version integer, _reason text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_row public.orders; uid uuid; new_version integer;
BEGIN
  uid := public.assert_permission('orders.cancel');
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'GECERSIZ: İptal gerekçesi zorunludur.';
  END IF;
  SELECT * INTO old_row FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sipariş yok.'; END IF;
  IF old_row.closure_status = 'iptal' THEN
    RAISE EXCEPTION 'IPTAL_EDILMIS: Sipariş zaten iptal edilmiş.';
  END IF;
  IF old_row.row_version <> _row_version THEN
    RAISE EXCEPTION 'SURUM_ESKI: Kayıt siz açtıktan sonra değişti.';
  END IF;
  -- Grafik yalnızca kendi açtığı siparişi iptal edebilir; Asistan/Müdür/Admin sınırsızdır.
  IF NOT public.has_permission(uid, 'team.manage')
     AND NOT public.has_permission(uid, 'admin.configure')
     AND old_row.created_by IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'YETKISIZ: Yalnızca kendi açtığınız siparişi iptal edebilirsiniz.';
  END IF;

  UPDATE public.orders SET closure_status = 'iptal', cancel_reason = btrim(_reason),
    cancelled_at = now(), cancelled_by = uid, row_version = old_row.row_version + 1,
    updated_by = uid
  WHERE id = _order_id RETURNING row_version INTO new_version;

  PERFORM public.write_audit('order.cancelled', 'orders', _order_id::text,
    jsonb_build_object('closure_status', old_row.closure_status),
    jsonb_build_object('closure_status', 'iptal'), btrim(_reason));
  RETURN new_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_graphic_status(
  _order_id uuid, _row_version integer, _status public.graphic_status, _reason text DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_row public.orders; new_version integer;
BEGIN
  PERFORM public.assert_permission('orders.edit_graphics');
  SELECT * INTO old_row FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sipariş yok.'; END IF;
  IF old_row.closure_status = 'iptal' THEN
    RAISE EXCEPTION 'IPTAL_EDILMIS: İptal edilmiş sipariş değiştirilemez.';
  END IF;
  IF old_row.row_version <> _row_version THEN
    RAISE EXCEPTION 'SURUM_ESKI: Kayıt siz açtıktan sonra değişti.';
  END IF;

  UPDATE public.orders SET graphic_status = _status,
    row_version = old_row.row_version + 1, updated_by = auth.uid()
  WHERE id = _order_id RETURNING row_version INTO new_version;

  PERFORM public.write_audit('order.graphic_status_changed', 'orders', _order_id::text,
    jsonb_build_object('graphic_status', old_row.graphic_status),
    jsonb_build_object('graphic_status', _status), _reason);
  RETURN new_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_graphic_revision(
  _order_id uuid,
  _storage_path text,
  _filename text,
  _byte_size bigint,
  _content_type text,
  _checksum text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ord public.orders; cmd record; next_rev integer; new_id uuid;
BEGIN
  PERFORM public.assert_permission('orders.edit_graphics');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'attach_graphic_revision');
  IF NOT cmd.is_new THEN RETURN cmd.prior::jsonb; END IF;

  IF _content_type <> 'application/pdf' THEN
    RAISE EXCEPTION 'DOSYA_GECERSIZ: Yalnızca PDF dosyası yüklenebilir.';
  END IF;
  IF _byte_size IS NULL OR _byte_size <= 0 OR _byte_size > 52428800 THEN
    RAISE EXCEPTION 'DOSYA_GECERSIZ: Dosya boş olamaz ve 50 MB sınırını aşamaz.';
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sipariş yok.'; END IF;
  IF ord.closure_status = 'iptal' THEN
    RAISE EXCEPTION 'IPTAL_EDILMIS: İptal edilmiş siparişe dosya yüklenemez.';
  END IF;

  SELECT COALESCE(max(revision_no), 0) + 1 INTO next_rev
  FROM public.graphic_assets WHERE order_id = _order_id;

  UPDATE public.graphic_assets SET is_current = false
   WHERE order_id = _order_id AND is_current;

  INSERT INTO public.graphic_assets (order_id, revision_no, storage_path, filename,
    byte_size, content_type, checksum, is_current, uploaded_by)
  VALUES (_order_id, next_rev, _storage_path, _filename, _byte_size, _content_type,
    _checksum, true, auth.uid())
  RETURNING id INTO new_id;

  PERFORM public.write_audit('graphic_asset.uploaded', 'graphic_assets', new_id::text, NULL,
    jsonb_build_object('order_id', _order_id, 'revision_no', next_rev, 'filename', _filename,
      'byte_size', _byte_size), NULL);

  PERFORM public.command_finish(_idempotency_key,
    jsonb_build_object('id', new_id, 'revision_no', next_rev)::text);
  RETURN jsonb_build_object('id', new_id, 'revision_no', next_rev);
END;
$$;

-- 10) Yetkiler: istemci yalnızca RPC'leri çağırabilir
REVOKE ALL ON FUNCTION public.command_begin(text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.command_finish(text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_permission(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.command_begin(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.command_finish(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.assert_permission(text) TO service_role;

REVOKE ALL ON FUNCTION public.can_read_orders() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_read_orders() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_create_customer(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_update_customer(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.admin_set_customer_active(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_customer(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_customer(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_customer_active(uuid, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_order(uuid, text, text, integer, numeric, numeric, date, date, public.supply_status, public.order_priority, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, text, text, integer, numeric, numeric, date, date, public.supply_status, public.order_priority, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.update_order(uuid, integer, text, text, integer, numeric, numeric, date, public.supply_status, public.order_priority, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_order(uuid, integer, text, text, integer, numeric, numeric, date, public.supply_status, public.order_priority, text, text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_order(uuid, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, integer, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_graphic_status(uuid, integer, public.graphic_status, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_graphic_status(uuid, integer, public.graphic_status, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.attach_graphic_revision(uuid, text, text, bigint, text, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.attach_graphic_revision(uuid, text, text, bigint, text, text, text) TO authenticated, service_role;