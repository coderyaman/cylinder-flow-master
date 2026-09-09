-- Denetim atomikliği sınaması: rol değişikliği + kasıtlı olarak başarısız denetim kaydı.
-- Her zaman hata verir; işlem geri alınır, kalıcı değişiklik bırakmaz.
CREATE OR REPLACE FUNCTION public.audit_atomicity_probe(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_admin_caller();
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'grafik')
  ON CONFLICT (user_id, role) DO NOTHING;
  -- entity_type NOT NULL: denetim kaydı yazılamaz, bütün işlem geri alınır.
  INSERT INTO public.audit_log (actor_id, action, entity_type)
  VALUES (auth.uid(), 'test.audit_atomicity', NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.audit_atomicity_probe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_atomicity_probe(uuid) TO authenticated, service_role;