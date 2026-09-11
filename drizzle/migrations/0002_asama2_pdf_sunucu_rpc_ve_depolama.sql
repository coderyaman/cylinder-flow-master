-- Sunucu (service_role) tarafından çağrılabilen ince sarmalayıcılar; istemciye kapalı.
CREATE OR REPLACE FUNCTION public.srv_graphic_upload_target(_actor uuid, _order_id uuid, _expected_revision integer)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT private.graphic_upload_target(_actor, _order_id, _expected_revision); $function$;
REVOKE ALL ON FUNCTION public.srv_graphic_upload_target(uuid, uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_graphic_upload_target(uuid, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.srv_attach_graphic_revision(
  _actor uuid, _session_id uuid, _filename text, _byte_size bigint, _checksum text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT private.attach_graphic_revision_v2(_actor, _session_id, _filename, _byte_size, _checksum); $function$;
REVOKE ALL ON FUNCTION public.srv_attach_graphic_revision(uuid, uuid, text, bigint, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_attach_graphic_revision(uuid, uuid, text, bigint, text) TO service_role;

CREATE OR REPLACE FUNCTION public.srv_graphic_access_grant(_actor uuid, _asset_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT private.graphic_access_grant(_actor, _asset_id); $function$;
REVOKE ALL ON FUNCTION public.srv_graphic_access_grant(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_graphic_access_grant(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.srv_graphic_orphan_sessions(_older_minutes integer DEFAULT 60)
RETURNS TABLE(session_id uuid, storage_path text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT * FROM private.graphic_orphan_sessions(_older_minutes); $function$;
REVOKE ALL ON FUNCTION public.srv_graphic_orphan_sessions(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_graphic_orphan_sessions(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.srv_graphic_mark_cleaned(_session_ids uuid[])
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT private.graphic_mark_cleaned(_session_ids); $function$;
REVOKE ALL ON FUNCTION public.srv_graphic_mark_cleaned(uuid[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_graphic_mark_cleaned(uuid[]) TO service_role;

-- Doğrudan depolama erişimi kapatılır (yalnızca sunucunun ürettiği imzalı hedef/bağlantı).
DROP POLICY IF EXISTS grafik_pdf_read ON storage.objects;
DROP POLICY IF EXISTS grafik_pdf_upload ON storage.objects;
