-- Aşama 2 düzeltme 4:
-- (a) PDF kesinleştirme ile temizlik arasındaki yarışı atomik durum geçişleriyle kapatır,
-- (b) aynı oturumun tekrarında önceki başarılı revizyon sonucunu döndürür,
-- (c) create_order / update_order işlem anahtarı içerik özetini tamamlar.

ALTER TABLE public.graphic_upload_sessions
  ADD COLUMN IF NOT EXISTS cleanup_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS result_asset_id uuid,
  ADD COLUMN IF NOT EXISTS result_revision_no integer;

-- Kesinleştirme: oturum satırı kilitlenir; temizliğe ayrılmış/temizlenmiş oturum kesinleştirilemez.
CREATE OR REPLACE FUNCTION private.attach_graphic_revision_v3(
  _actor uuid, _session_id uuid, _filename text, _byte_size bigint, _checksum text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE sess public.graphic_upload_sessions; ord public.orders; cur integer; new_id uuid; next_rev integer;
BEGIN
  SELECT * INTO sess FROM public.graphic_upload_sessions WHERE id = _session_id FOR UPDATE;
  IF sess.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Yükleme oturumu yok.'; END IF;
  IF sess.user_id IS DISTINCT FROM _actor THEN
    RAISE EXCEPTION 'YETKISIZ: Bu yükleme oturumu size ait değil.';
  END IF;

  -- Tekrar gönderim: kayıt zaten oluştuysa aynı sonuç döner, yeni revizyon üretilmez.
  IF sess.consumed_at IS NOT NULL THEN
    IF sess.result_asset_id IS NOT NULL THEN
      RETURN jsonb_build_object('id', sess.result_asset_id,
        'revision_no', sess.result_revision_no, 'replayed', true);
    END IF;
    RAISE EXCEPTION 'OTURUM_KULLANILDI: Bu yükleme zaten kesinleştirildi.';
  END IF;

  IF sess.cleaned_at IS NOT NULL OR sess.cleanup_claimed_at IS NOT NULL THEN
    RAISE EXCEPTION 'OTURUM_TEMIZLENDI: Bu yükleme temizliğe alındı; dosyayı yeniden yükleyin.';
  END IF;

  IF _byte_size IS NULL OR _byte_size <= 0 OR _byte_size > 52428800 THEN
    RAISE EXCEPTION 'DOSYA_GECERSIZ: Dosya boş olamaz ve 50 MB sınırını aşamaz.';
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = sess.order_id FOR UPDATE;
  IF ord.closure_status = 'iptal' THEN
    RAISE EXCEPTION 'IPTAL_EDILMIS: İptal edilmiş siparişe dosya eklenemez.';
  END IF;
  IF NOT private.has_permission_internal(_actor, 'orders.edit_graphics') THEN
    RAISE EXCEPTION 'YETKISIZ: Grafik dosyası yükleme yetkiniz yok.';
  END IF;
  IF ord.created_by IS DISTINCT FROM _actor
     AND NOT private.has_permission_internal(_actor, 'orders.edit_all') THEN
    RAISE EXCEPTION 'YETKISIZ: Yalnızca kendi açtığınız siparişe dosya yükleyebilirsiniz.';
  END IF;

  SELECT COALESCE(max(revision_no), 0) INTO cur FROM public.graphic_assets WHERE order_id = sess.order_id;
  IF cur <> sess.expected_revision THEN
    RAISE EXCEPTION 'REVIZYON_CAKISMASI: Siz yüklerken yeni revizyon geldi (şu an %). Dosyanız kesinleştirilmedi; yeniden değerlendirip tekrar yükleyebilirsiniz.', cur;
  END IF;
  next_rev := cur + 1;

  UPDATE public.graphic_assets SET is_current = false WHERE order_id = sess.order_id AND is_current;

  INSERT INTO public.graphic_assets (order_id, revision_no, storage_path, filename,
    byte_size, content_type, checksum, is_current, uploaded_by)
  VALUES (sess.order_id, next_rev, sess.storage_path, _filename, _byte_size,
    'application/pdf', _checksum, true, _actor)
  RETURNING id INTO new_id;

  UPDATE public.graphic_upload_sessions
     SET consumed_at = now(), result_asset_id = new_id, result_revision_no = next_rev
   WHERE id = sess.id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_value, reason)
  VALUES (_actor, 'graphic_asset.uploaded', 'graphic_assets', new_id::text,
    jsonb_build_object('order_id', sess.order_id, 'revision_no', next_rev,
      'filename', _filename, 'byte_size', _byte_size), NULL);

  RETURN jsonb_build_object('id', new_id, 'revision_no', next_rev, 'replayed', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.srv_attach_graphic_revision(
  _actor uuid, _session_id uuid, _filename text, _byte_size bigint, _checksum text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT private.attach_graphic_revision_v3(_actor, _session_id, _filename, _byte_size, _checksum); $function$;
REVOKE ALL ON FUNCTION public.srv_attach_graphic_revision(uuid, uuid, text, bigint, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_attach_graphic_revision(uuid, uuid, text, bigint, text) TO service_role;

-- Temizlik: silmeden ÖNCE oturumlar atomik olarak temizliğe ayrılır (satır kilidi + SKIP LOCKED).
CREATE OR REPLACE FUNCTION private.graphic_claim_orphans(_older_minutes integer DEFAULT 60)
RETURNS TABLE(session_id uuid, storage_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH aday AS (
    SELECT s.id
    FROM public.graphic_upload_sessions s
    WHERE s.consumed_at IS NULL
      AND s.cleaned_at IS NULL
      AND s.cleanup_claimed_at IS NULL
      AND s.created_at < now() - make_interval(mins => _older_minutes)
      AND NOT EXISTS (SELECT 1 FROM public.graphic_assets g WHERE g.storage_path = s.storage_path)
    ORDER BY s.created_at
    LIMIT 200
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.graphic_upload_sessions t
     SET cleanup_claimed_at = now()
    FROM aday
   WHERE t.id = aday.id
     AND t.consumed_at IS NULL
     AND t.cleaned_at IS NULL
     AND t.cleanup_claimed_at IS NULL
  RETURNING t.id, t.storage_path;
END;
$function$;

CREATE OR REPLACE FUNCTION public.srv_graphic_claim_orphans(_older_minutes integer DEFAULT 60)
RETURNS TABLE(session_id uuid, storage_path text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT * FROM private.graphic_claim_orphans(_older_minutes); $function$;
REVOKE ALL ON FUNCTION public.srv_graphic_claim_orphans(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_graphic_claim_orphans(integer) TO service_role;

-- Yalnızca temizliğe ayrılmış ve kesinleştirilmemiş oturumlar temizlenmiş sayılır.
CREATE OR REPLACE FUNCTION private.graphic_mark_cleaned(_session_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  UPDATE public.graphic_upload_sessions SET cleaned_at = now()
   WHERE id = ANY(_session_ids)
     AND consumed_at IS NULL
     AND cleanup_claimed_at IS NOT NULL
     AND cleaned_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_value, reason)
    VALUES (NULL, 'graphic_asset.orphan_cleaned', 'graphic_upload_sessions', NULL,
      jsonb_build_object('count', n), 'Kaydı olmayan yüklemeler temizlendi');
  END IF;
  RETURN n;
END;
$function$;

-- İşlem anahtarı içerik özeti: kalıcı sonucu veya denetim kaydını etkileyen bütün alanlar.
CREATE OR REPLACE FUNCTION public.create_order(_customer_id uuid, _work_order_no text, _name text, _quantity integer, _nominal_circumference_mm numeric, _target_length_mm numeric, _due_on date, _ordered_on date DEFAULT CURRENT_DATE, _supply_status supply_status DEFAULT 'belirsiz'::supply_status, _priority order_priority DEFAULT 'normal'::order_priority, _note text DEFAULT NULL::text, _critical_note text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE new_id uuid; cmd record; cust public.customers;
BEGIN
  PERFORM public.assert_permission('orders.create');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'create_order',
    jsonb_build_object(
      'customer_id', _customer_id,
      'work_order_no', btrim(COALESCE(_work_order_no,'')),
      'name', btrim(COALESCE(_name,'')),
      'quantity', _quantity,
      'nominal_circumference_mm', _nominal_circumference_mm,
      'target_length_mm', _target_length_mm,
      'ordered_on', COALESCE(_ordered_on, current_date),
      'due_on', _due_on,
      'supply_status', _supply_status,
      'priority', _priority,
      'note', NULLIF(btrim(COALESCE(_note,'')),''),
      'critical_note', NULLIF(btrim(COALESCE(_critical_note,'')),'')));
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

CREATE OR REPLACE FUNCTION public.update_order(_order_id uuid, _row_version integer, _work_order_no text, _name text, _quantity integer, _nominal_circumference_mm numeric, _target_length_mm numeric, _due_on date, _supply_status supply_status, _priority order_priority, _note text DEFAULT NULL::text, _critical_note text DEFAULT NULL::text, _reason text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE old_row public.orders; new_row public.orders; uid uuid; cmd record;
BEGIN
  uid := public.assert_permission('orders.create');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'update_order',
    jsonb_build_object(
      'order_id', _order_id,
      'row_version', _row_version,
      'work_order_no', btrim(COALESCE(_work_order_no,'')),
      'name', btrim(COALESCE(_name,'')),
      'quantity', _quantity,
      'nominal_circumference_mm', _nominal_circumference_mm,
      'target_length_mm', _target_length_mm,
      'due_on', _due_on,
      'supply_status', _supply_status,
      'priority', _priority,
      'note', NULLIF(btrim(COALESCE(_note,'')),''),
      'critical_note', NULLIF(btrim(COALESCE(_critical_note,'')),''),
      'reason', NULLIF(btrim(COALESCE(_reason,'')),'')));
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