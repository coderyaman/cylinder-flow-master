-- 1) Test amaçlı sonda fonksiyonu üretim şemasından kaldır
DROP FUNCTION IF EXISTS public.audit_atomicity_probe(uuid);

-- 2) Kayıt anında rol verme kaldırıldı: davet yalnızca e-posta doğrulandıktan sonra kullanılır
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv public.user_invites;
  signup_open boolean;
BEGIN
  SELECT * INTO inv FROM public.user_invites
   WHERE email = lower(NEW.email) AND accepted_at IS NULL;

  SELECT COALESCE((value #>> '{}')::boolean, false) INTO signup_open
    FROM public.app_settings WHERE key = 'signup_open';

  IF inv.id IS NULL AND COALESCE(signup_open, false) = false THEN
    RAISE EXCEPTION 'KAYIT_KAPALI: Bu sisteme yalnızca yönetici daveti ile kayıt olunabilir.';
  END IF;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id,
          COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), COALESCE(inv.full_name, '')),
          NEW.email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_value, reason)
  VALUES (NEW.id, 'user.created', 'profiles', NEW.id::text,
          jsonb_build_object('email', NEW.email),
          CASE WHEN inv.id IS NULL THEN 'Açık kayıt' ELSE 'Davet ile kayıt (rol e-posta doğrulaması sonrası verilir)' END);

  RETURN NEW;
END;
$$;

-- 3) Daveti üstlenme: yalnızca e-posta sahipliği doğrulanmış oturum sahibi kullanabilir
CREATE OR REPLACE FUNCTION public.claim_invite()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  u_email text;
  confirmed timestamptz;
  inv public.user_invites;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'YETKISIZ: Oturum bulunamadı.';
  END IF;

  SELECT lower(email), COALESCE(email_confirmed_at, confirmed_at)
    INTO u_email, confirmed
    FROM auth.users WHERE id = uid;

  IF confirmed IS NULL THEN
    RAISE EXCEPTION 'EPOSTA_DOGRULANMADI: Daveti kullanmak için e-posta adresinizi doğrulamanız gerekir.';
  END IF;

  SELECT * INTO inv FROM public.user_invites
   WHERE email = u_email AND accepted_at IS NULL
   FOR UPDATE;

  IF inv.id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'davet_yok');
  END IF;

  IF inv.role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, inv.role)
    ON CONFLICT (user_id, role) DO NOTHING;
    PERFORM public.write_audit('role.granted', 'user_roles', uid::text, NULL,
      jsonb_build_object('role', inv.role), 'Doğrulanmış e-posta ile davet kabul edildi');
  END IF;

  UPDATE public.user_invites
     SET accepted_at = now(), accepted_user_id = uid
   WHERE id = inv.id;

  PERFORM public.write_audit('user_invite.accepted', 'user_invites', inv.id::text, NULL,
    jsonb_build_object('email', u_email, 'role', inv.role), NULL);

  RETURN jsonb_build_object('claimed', true, 'role', inv.role);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_invite() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_invite() TO authenticated, service_role;