-- Aşama 2 düzeltme 2: sunucu denetimli PDF yükleme/erişim akışı
-- Sunucuya özel mantık API'ye açık olmayan `private` şemasında tutulur.

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO service_role;

CREATE TABLE IF NOT EXISTS public.graphic_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  storage_path text NOT NULL UNIQUE,
  expected_revision integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  cleaned_at timestamptz
);

GRANT SELECT ON public.graphic_upload_sessions TO authenticated;
GRANT ALL ON public.graphic_upload_sessions TO service_role;
ALTER TABLE public.graphic_upload_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS upload_sessions_select_own ON public.graphic_upload_sessions;
CREATE POLICY upload_sessions_select_own ON public.graphic_upload_sessions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION private.has_permission_internal(_user_id uuid, _permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT o.granted FROM public.user_permission_overrides o
      WHERE o.user_id = _user_id AND o.permission_code = _permission),
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role = ur.role
      WHERE ur.user_id = _user_id AND rp.permission_code = _permission
    )
  ) AND public.is_active_user(_user_id);
$function$;

CREATE OR REPLACE FUNCTION private.graphic_upload_target(_actor uuid, _order_id uuid, _expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE ord public.orders; sid uuid := gen_random_uuid(); cur integer;
BEGIN
  IF NOT private.has_permission_internal(_actor, 'orders.edit_graphics') THEN
    RAISE EXCEPTION 'YETKISIZ: Grafik dosyası yükleme yetkiniz yok.';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id = _order_id;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sipariş yok.'; END IF;
  IF ord.closure_status = 'iptal' THEN
    RAISE EXCEPTION 'IPTAL_EDILMIS: İptal edilmiş siparişe dosya yüklenemez.';
  END IF;
  IF ord.created_by IS DISTINCT FROM _actor
     AND NOT private.has_permission_internal(_actor, 'orders.edit_all') THEN
    RAISE EXCEPTION 'YETKISIZ: Yalnızca kendi açtığınız siparişe dosya yükleyebilirsiniz.';
  END IF;

  SELECT COALESCE(max(revision_no), 0) INTO cur FROM public.graphic_assets WHERE order_id = _order_id;
  IF _expected_revision IS NULL OR _expected_revision <> cur THEN
    RAISE EXCEPTION 'REVIZYON_CAKISMASI: Güncel revizyon değişti (şu an %). Dosyanızı kaybetmeden yeniden değerlendirin.', cur;
  END IF;

  INSERT INTO public.graphic_upload_sessions (id, order_id, user_id, storage_path, expected_revision)
  VALUES (sid, _order_id, _actor, _order_id::text || '/' || sid::text || '.pdf', cur);

  RETURN jsonb_build_object('session_id', sid,
    'storage_path', _order_id::text || '/' || sid::text || '.pdf');
END;
$function$;

CREATE OR REPLACE FUNCTION private.attach_graphic_revision_v2(
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
  IF sess.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'OTURUM_KULLANILDI: Bu yükleme zaten kesinleştirildi.';
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

  UPDATE public.graphic_upload_sessions SET consumed_at = now() WHERE id = sess.id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_value, reason)
  VALUES (_actor, 'graphic_asset.uploaded', 'graphic_assets', new_id::text,
    jsonb_build_object('order_id', sess.order_id, 'revision_no', next_rev,
      'filename', _filename, 'byte_size', _byte_size), NULL);

  RETURN jsonb_build_object('id', new_id, 'revision_no', next_rev);
END;
$function$;

CREATE OR REPLACE FUNCTION private.graphic_access_grant(_actor uuid, _asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE a public.graphic_assets;
BEGIN
  IF NOT private.has_permission_internal(_actor, 'orders.read_graphic_file') THEN
    RAISE EXCEPTION 'YETKISIZ: Grafik dosyasına erişim yetkiniz yok.';
  END IF;
  SELECT * INTO a FROM public.graphic_assets WHERE id = _asset_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Dosya kaydı yok.'; END IF;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_value, reason)
  VALUES (_actor, 'graphic_asset.link_created', 'graphic_assets', a.id::text,
    jsonb_build_object('order_id', a.order_id, 'revision_no', a.revision_no),
    'Erişim bağlantısı oluşturuldu (dosyanın indirildiği anlamına gelmez)');

  RETURN jsonb_build_object('storage_path', a.storage_path, 'filename', a.filename);
END;
$function$;

CREATE OR REPLACE FUNCTION private.graphic_orphan_sessions(_older_minutes integer DEFAULT 60)
RETURNS TABLE(session_id uuid, storage_path text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT s.id, s.storage_path
  FROM public.graphic_upload_sessions s
  WHERE s.consumed_at IS NULL
    AND s.cleaned_at IS NULL
    AND s.created_at < now() - make_interval(mins => _older_minutes)
    AND NOT EXISTS (SELECT 1 FROM public.graphic_assets g WHERE g.storage_path = s.storage_path)
  LIMIT 200;
$function$;

CREATE OR REPLACE FUNCTION private.graphic_mark_cleaned(_session_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  UPDATE public.graphic_upload_sessions SET cleaned_at = now()
   WHERE id = ANY(_session_ids) AND consumed_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_value, reason)
    VALUES (NULL, 'graphic_asset.orphan_cleaned', 'graphic_upload_sessions', NULL,
      jsonb_build_object('count', n), 'Kaydı olmayan yüklemeler temizlendi');
  END IF;
  RETURN n;
END;
$function$;

-- Doğrudan depolama erişimi kapatılır: yalnızca sunucunun ürettiği imzalı hedef/bağlantı geçerlidir.
DROP POLICY IF EXISTS "grafik_pdf_insert" ON storage.objects;
DROP POLICY IF EXISTS "grafik_pdf_select" ON storage.objects;
DROP POLICY IF EXISTS "grafik pdf upload" ON storage.objects;
DROP POLICY IF EXISTS "grafik pdf read" ON storage.objects;
