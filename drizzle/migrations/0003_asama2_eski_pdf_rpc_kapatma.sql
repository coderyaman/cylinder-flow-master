-- Doğrulamasız eski PDF ekleme yolu istemciye kapatılır; yerine sunucu denetimli akış kullanılır.
REVOKE ALL ON FUNCTION public.attach_graphic_revision(uuid, text, text, bigint, text, text, text) FROM public, anon, authenticated;
