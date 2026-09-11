-- Aşama 2 düzeltme 1: yetkilendirme ve veri güvenilirliği

-- 1) Başkasının siparişini düzenlemek için açık yetki
INSERT INTO public.permissions (code, label, category)
VALUES ('orders.edit_all', 'Başkasının siparişini düzenleme/iptal', 'siparis')
ON CONFLICT (code) DO NOTHING;

-- 2) İşlem anahtarı sözleşmesi: kullanıcı + komut + içerik kapsamı
ALTER TABLE public.command_log ADD COLUMN IF NOT EXISTS payload_hash text;

CREATE OR REPLACE FUNCTION public.command_begin(_key text, _command text, _payload jsonb)
RETURNS TABLE(is_new boolean, prior text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE existing public.command_log; inserted boolean := false; h text;
BEGIN
  IF _key IS NULL OR btrim(_key) = '' THEN
    RETURN QUERY SELECT true, NULL::text; RETURN;
  END IF;
  h := md5(COALESCE(_payload, '{}'::jsonb)::text);
  INSERT INTO public.command_log (idempotency_key, command, actor_id, payload_hash)
  VALUES (_key, _command, auth.uid(), h)
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted THEN RETURN QUERY SELECT true, NULL::text; RETURN; END IF;

  SELECT * INTO existing FROM public.command_log WHERE idempotency_key = _key;
  IF existing.actor_id IS DISTINCT FROM auth.uid()
     OR existing.command IS DISTINCT FROM _command
     OR existing.payload_hash IS DISTINCT FROM h THEN
    RAISE EXCEPTION 'ANAHTAR_CAKISMASI: Aynı işlem anahtarı farklı bir istekle kullanılamaz.';
  END IF;
  IF existing.result_ref IS NULL THEN
    RAISE EXCEPTION 'ISLEM_DEVAM: Aynı istek halen işleniyor, lütfen bekleyin.';
  END IF;
  RETURN QUERY SELECT false, existing.result_ref;
END;
$function$;

REVOKE ALL ON FUNCTION public.command_begin(text, text, jsonb) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.command_begin(text, text, jsonb) TO service_role;

-- 3) Sipariş yazma yetkisi: kendi siparişi mi, yoksa açık geniş yetki mi?
CREATE OR REPLACE FUNCTION public.assert_can_write_order(_order public.orders, _uid uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF _order.created_by IS NOT DISTINCT FROM _uid THEN RETURN; END IF;
  IF public.has_permission(_uid, 'orders.edit_all') THEN RETURN; END IF;
  RAISE EXCEPTION 'YETKISIZ: Yalnızca kendi açtığınız siparişi değiştirebilirsiniz.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.assert_row_version(_given integer, _current integer)
RETURNS void
LANGUAGE plpgsql IMMUTABLE
AS $function$
BEGIN
  IF _given IS NULL OR _given <= 0 THEN
    RAISE EXCEPTION 'GECERSIZ: Kayıt sürümü gönderilmedi. Sayfayı yenileyip yeniden deneyin.';
  END IF;
  IF _given <> _current THEN
    RAISE EXCEPTION 'SURUM_ESKI: Kayıt siz açtıktan sonra değişti. Güncel hâli yükleyip yeniden deneyin.';
  END IF;
END;
$function$;

-- 4) Muhasebe genel sipariş okumasından çıkarıldı (ticari havuz kendi modülünde gelir)
CREATE OR REPLACE FUNCTION public.can_read_orders()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = auth.uid()
      AND p.is_active
      AND ur.role IN ('grafik','depo','asistan','mudur','patron','admin')
  );
$function$;

-- 5) Yazma komutları: sürüm kontrolü, sahiplik kontrolü, işlem anahtarı
DROP FUNCTION IF EXISTS public.update_order(uuid, integer, text, text, integer, numeric, numeric, date, supply_status, order_priority, text, text, text);

CREATE FUNCTION public.update_order(
  _order_id uuid, _row_version integer, _work_order_no text, _name text, _quantity integer,
  _nominal_circumference_mm numeric, _target_length_mm numeric, _due_on date,
  _supply_status supply_status, _priority order_priority,
  _note text DEFAULT NULL, _critical_note text DEFAULT NULL, _reason text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE old_row public.orders; new_row public.orders; uid uuid; cmd record;
BEGIN
  uid := public.assert_permission('orders.create');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'update_order',
    jsonb_build_object('order_id', _order_id, 'row_version', _row_version, 'name', _name,
      'work_order_no', _work_order_no, 'quantity', _quantity, 'due_on', _due_on));
  IF NOT cmd.is_new THEN RETURN cmd.prior::integer; END IF;

  SELECT * INTO old_row FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sipariş yok.'; END IF;
  IF old_row.closure_status = 'iptal' THEN
    RAISE EXCEPTION 'IPTAL_EDILMIS: İptal edilmiş sipariş değiştirilemez.';
  END IF;
  PERFORM public.assert_can_write_order(old_row, uid);
  PERFORM public.assert_row_version(_row_version, old_row.row_version);
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
      updated_by = uid
    WHERE id = _order_id
    RETURNING * INTO new_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'IS_EMRI_TEKRAR: Bu müşteride aynı iş emri numarası zaten var.';
  END;

  PERFORM public.write_audit('order.updated', 'orders', _order_id::text,
    to_jsonb(old_row), to_jsonb(new_row), _reason);
  PERFORM public.command_finish(_idempotency_key, new_row.row_version::text);
  RETURN new_row.row_version;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_order(uuid, integer, text, text, integer, numeric, numeric, date, supply_status, order_priority, text, text, text, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.set_graphic_status(uuid, integer, graphic_status, text);

CREATE FUNCTION public.set_graphic_status(
  _order_id uuid, _row_version integer, _status graphic_status,
  _reason text DEFAULT NULL, _idempotency_key text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE old_row public.orders; new_version integer; uid uuid; cmd record;
BEGIN
  uid := public.assert_permission('orders.edit_graphics');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'set_graphic_status',
    jsonb_build_object('order_id', _order_id, 'row_version', _row_version, 'status', _status));
  IF NOT cmd.is_new THEN RETURN cmd.prior::integer; END IF;

  SELECT * INTO old_row FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sipariş yok.'; END IF;
  IF old_row.closure_status = 'iptal' THEN
    RAISE EXCEPTION 'IPTAL_EDILMIS: İptal edilmiş sipariş değiştirilemez.';
  END IF;
  PERFORM public.assert_can_write_order(old_row, uid);
  PERFORM public.assert_row_version(_row_version, old_row.row_version);

  UPDATE public.orders SET graphic_status = _status,
    row_version = old_row.row_version + 1, updated_by = uid
  WHERE id = _order_id RETURNING row_version INTO new_version;

  PERFORM public.write_audit('order.graphic_status_changed', 'orders', _order_id::text,
    jsonb_build_object('graphic_status', old_row.graphic_status),
    jsonb_build_object('graphic_status', _status), _reason);
  PERFORM public.command_finish(_idempotency_key, new_version::text);
  RETURN new_version;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_graphic_status(uuid, integer, graphic_status, text, text) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.cancel_order(uuid, integer, text);

CREATE FUNCTION public.cancel_order(
  _order_id uuid, _row_version integer, _reason text, _idempotency_key text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE old_row public.orders; uid uuid; new_version integer; cmd record;
BEGIN
  uid := public.assert_permission('orders.cancel');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'cancel_order',
    jsonb_build_object('order_id', _order_id, 'row_version', _row_version, 'reason', btrim(COALESCE(_reason,''))));
  IF NOT cmd.is_new THEN RETURN cmd.prior::integer; END IF;

  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'GECERSIZ: İptal gerekçesi zorunludur.';
  END IF;
  SELECT * INTO old_row FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sipariş yok.'; END IF;
  IF old_row.closure_status = 'iptal' THEN
    RAISE EXCEPTION 'IPTAL_EDILMIS: Sipariş zaten iptal edilmiş.';
  END IF;
  PERFORM public.assert_can_write_order(old_row, uid);
  PERFORM public.assert_row_version(_row_version, old_row.row_version);

  UPDATE public.orders SET closure_status = 'iptal', cancel_reason = btrim(_reason),
    cancelled_at = now(), cancelled_by = uid, row_version = old_row.row_version + 1,
    updated_by = uid
  WHERE id = _order_id RETURNING row_version INTO new_version;

  PERFORM public.write_audit('order.cancelled', 'orders', _order_id::text,
    jsonb_build_object('closure_status', old_row.closure_status),
    jsonb_build_object('closure_status', 'iptal'), btrim(_reason));
  PERFORM public.command_finish(_idempotency_key, new_version::text);
  RETURN new_version;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_order(uuid, integer, text, text) TO authenticated, service_role;

-- create_order: yeni işlem anahtarı sözleşmesine geçiş
CREATE OR REPLACE FUNCTION public.create_order(
  _customer_id uuid, _work_order_no text, _name text, _quantity integer,
  _nominal_circumference_mm numeric, _target_length_mm numeric, _due_on date,
  _ordered_on date DEFAULT CURRENT_DATE, _supply_status supply_status DEFAULT 'belirsiz',
  _priority order_priority DEFAULT 'normal', _note text DEFAULT NULL,
  _critical_note text DEFAULT NULL, _idempotency_key text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE new_id uuid; cmd record; cust public.customers;
BEGIN
  PERFORM public.assert_permission('orders.create');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'create_order',
    jsonb_build_object('customer_id', _customer_id, 'work_order_no', btrim(COALESCE(_work_order_no,'')),
      'name', btrim(COALESCE(_name,'')), 'quantity', _quantity, 'due_on', _due_on));
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
$function$;
