-- Grafik bağlantısı service_role oturumunda üretildiği için auth.uid() NULL'dur.
-- public.is_admin / has_station_scope bu durumda "başka kullanıcı adına sorgu"
-- sayıp false döner ve yetkili operatör bile YETKISIZ hatası alır.
-- Bu yüzden istasyon yetkisi, aktör kimliği açıkça verilerek iç fonksiyonla denetlenir.
CREATE OR REPLACE FUNCTION private.station_allowed_internal(_uid uuid, _station_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.is_active)
    AND (
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = _uid AND ur.role = 'admin'
      )
      OR EXISTS (
        SELECT 1 FROM public.user_station_scopes s
        WHERE s.user_id = _uid AND s.station_id = _station_id
      )
    );
$$;

CREATE OR REPLACE FUNCTION private.operation_graphic_grant(_actor uuid, _operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
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
  IF NOT private.station_allowed_internal(_actor, op.station_id) THEN
    RAISE EXCEPTION 'YETKISIZ: Bu istasyonda işlem yetkiniz yok.';
  END IF;
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

REVOKE ALL ON FUNCTION private.station_allowed_internal(uuid, uuid) FROM PUBLIC;
