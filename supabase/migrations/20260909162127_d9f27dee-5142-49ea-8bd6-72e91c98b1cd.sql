-- =========================================================
-- Aşama 1 güvenlik sertleştirmesi (veri korunur, sıfırlama yok)
-- =========================================================

-- 1) DAVET TABLOSU -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  role public.app_role,
  full_name text,
  invited_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES auth.users(id)
);
GRANT SELECT ON public.user_invites TO authenticated;
GRANT ALL ON public.user_invites TO service_role;
ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;

-- 2) TEMEL YARDIMCILAR -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.is_active);
$$;
REVOKE ALL ON FUNCTION public.is_active_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_user(uuid) TO authenticated, service_role;

-- Çağıranın (auth.uid()) gerçekten aktif Admin olup olmadığı - iç kullanım
CREATE OR REPLACE FUNCTION public.caller_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin' AND p.is_active
  );
$$;
REVOKE ALL ON FUNCTION public.caller_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_is_admin() TO authenticated, service_role;

-- Başka kimlik için sorgulama yalnızca Admin'e açık
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS DISTINCT FROM auth.uid() AND NOT public.caller_is_admin() THEN false
    ELSE EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS DISTINCT FROM auth.uid() AND NOT public.caller_is_admin() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
      WHERE ur.user_id = _user_id AND ur.role = 'admin' AND p.is_active
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS DISTINCT FROM auth.uid() AND NOT public.caller_is_admin() THEN false
    ELSE COALESCE(
      (SELECT o.granted FROM public.user_permission_overrides o
        WHERE o.user_id = _user_id AND o.permission_code = _permission),
      EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role = ur.role
        WHERE ur.user_id = _user_id AND rp.permission_code = _permission
      )
    ) AND public.is_active_user(_user_id)
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_station_scope(_user_id uuid, _station_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS DISTINCT FROM auth.uid() AND NOT public.caller_is_admin() THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_station_scopes s
      WHERE s.user_id = _user_id AND s.station_id = _station_id
    ) AND public.is_active_user(_user_id)
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _user_id)
     AND public.is_active_user(_user_id);
$$;
REVOKE ALL ON FUNCTION public.has_any_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid) TO authenticated, service_role;

-- Personel dizinini görebilecek görevler
CREATE OR REPLACE FUNCTION public.can_read_directory()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.caller_is_admin()
      OR public.has_permission(auth.uid(), 'audit.read')
      OR public.has_permission(auth.uid(), 'team.manage');
$$;
REVOKE ALL ON FUNCTION public.can_read_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_directory() TO authenticated, service_role;

-- 3) DENETİM KAYDI: yalnızca sunucu yazar --------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated;
DROP POLICY IF EXISTS "audit_insert" ON public.audit_log;

CREATE OR REPLACE FUNCTION public.write_audit(
  _action text, _entity_type text, _entity_id text,
  _old jsonb, _new jsonb, _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
  VALUES (auth.uid(), _action, _entity_type, _entity_id, _old, _new, _reason)
  RETURNING id INTO new_id;
  IF new_id IS NULL THEN
    RAISE EXCEPTION 'AUDIT_YAZILAMADI: Denetim kaydı oluşturulamadı, işlem geri alındı.';
  END IF;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.write_audit(text, text, text, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit(text, text, text, jsonb, jsonb, text) TO service_role;

-- 4) YÖNETİM İŞLEM FONKSİYONLARI ---------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_admin_caller()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'YETKISIZ: Oturum bulunamadı.'; END IF;
  IF NOT public.is_active_user(uid) THEN RAISE EXCEPTION 'PASIF_HESAP: Hesabınız pasif durumda.'; END IF;
  IF NOT public.has_permission(uid, 'admin.configure') THEN
    RAISE EXCEPTION 'YETKISIZ: Bu işlem için sistem yönetimi izni gerekir.';
  END IF;
  RETURN uid;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_admin_caller() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_admin_caller() TO service_role;

-- Son aktif Admin koruması (eşzamanlı işlemlerde kilit ile)
CREATE OR REPLACE FUNCTION public.assert_admin_remains(_target uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE remaining int;
BEGIN
  PERFORM 1 FROM public.user_roles WHERE role = 'admin' FOR UPDATE;
  SELECT count(*) INTO remaining
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = 'admin'
    AND p.is_active
    AND ur.user_id <> _target
    AND COALESCE((SELECT o.granted FROM public.user_permission_overrides o
                   WHERE o.user_id = ur.user_id AND o.permission_code = 'admin.configure'), true);
  IF remaining = 0 THEN
    RAISE EXCEPTION 'SON_ADMIN: Sistemde en az bir aktif Admin kalmalıdır.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_admin_remains(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_admin_remains(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(_user_id uuid, _role public.app_role, _on boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_admin_caller();
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    RAISE EXCEPTION 'BULUNAMADI: Kullanıcı yok.';
  END IF;
  IF _on THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role)
    ON CONFLICT (user_id, role) DO NOTHING;
    PERFORM public.write_audit('role.granted', 'user_roles', _user_id::text, NULL,
      jsonb_build_object('role', _role), _reason);
  ELSE
    IF _role = 'admin' THEN PERFORM public.assert_admin_remains(_user_id); END IF;
    DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
    PERFORM public.write_audit('role.revoked', 'user_roles', _user_id::text,
      jsonb_build_object('role', _role), NULL, _reason);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_station_scope(_user_id uuid, _station_id uuid, _on boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.assert_admin_caller();
  IF _on THEN
    INSERT INTO public.user_station_scopes (user_id, station_id) VALUES (_user_id, _station_id)
    ON CONFLICT (user_id, station_id) DO NOTHING;
    PERFORM public.write_audit('station_scope.granted', 'user_station_scopes', _user_id::text, NULL,
      jsonb_build_object('station_id', _station_id), _reason);
  ELSE
    DELETE FROM public.user_station_scopes WHERE user_id = _user_id AND station_id = _station_id;
    PERFORM public.write_audit('station_scope.revoked', 'user_station_scopes', _user_id::text,
      jsonb_build_object('station_id', _station_id), NULL, _reason);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_permission_override(_user_id uuid, _permission_code text, _granted boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_row public.user_permission_overrides;
BEGIN
  PERFORM public.assert_admin_caller();
  SELECT * INTO old_row FROM public.user_permission_overrides
   WHERE user_id = _user_id AND permission_code = _permission_code;

  IF _granted IS NULL THEN
    IF _permission_code = 'admin.configure'
       AND old_row.granted IS TRUE
       AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin') THEN
      PERFORM public.assert_admin_remains(_user_id);
    END IF;
    DELETE FROM public.user_permission_overrides
     WHERE user_id = _user_id AND permission_code = _permission_code;
    PERFORM public.write_audit('permission_override.cleared', 'user_permission_overrides', _user_id::text,
      to_jsonb(old_row), NULL, COALESCE(_reason, 'Rol varsayılanına dönüldü'));
  ELSE
    IF _permission_code = 'admin.configure' AND _granted = false THEN
      PERFORM public.assert_admin_remains(_user_id);
    END IF;
    INSERT INTO public.user_permission_overrides (user_id, permission_code, granted, reason, created_by)
    VALUES (_user_id, _permission_code, _granted, _reason, auth.uid())
    ON CONFLICT (user_id, permission_code)
    DO UPDATE SET granted = EXCLUDED.granted, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by;
    PERFORM public.write_audit('permission_override.set', 'user_permission_overrides', _user_id::text,
      to_jsonb(old_row), jsonb_build_object('permission_code', _permission_code, 'granted', _granted), _reason);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_active(_user_id uuid, _active boolean, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_active boolean;
BEGIN
  PERFORM public.assert_admin_caller();
  SELECT is_active INTO old_active FROM public.profiles WHERE id = _user_id;
  IF old_active IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Kullanıcı yok.'; END IF;
  IF _active = false THEN
    IF _user_id = auth.uid() THEN
      RAISE EXCEPTION 'GECERSIZ: Kendi hesabınızı pasifleştiremezsiniz.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin') THEN
      PERFORM public.assert_admin_remains(_user_id);
    END IF;
  END IF;
  UPDATE public.profiles SET is_active = _active WHERE id = _user_id;
  PERFORM public.write_audit('profile.active_changed', 'profiles', _user_id::text,
    jsonb_build_object('is_active', old_active), jsonb_build_object('is_active', _active), _reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_station(_code text, _name text, _sort_order integer DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid; ord integer;
BEGIN
  PERFORM public.assert_admin_caller();
  ord := COALESCE(_sort_order, (SELECT COALESCE(max(sort_order), 0) + 10 FROM public.stations));
  INSERT INTO public.stations (code, name, sort_order)
  VALUES (upper(trim(_code)), trim(_name), ord) RETURNING id INTO new_id;
  PERFORM public.write_audit('station.created', 'stations', new_id::text, NULL,
    jsonb_build_object('code', upper(trim(_code)), 'name', trim(_name)), NULL);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_station_active(_station_id uuid, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_active boolean;
BEGIN
  PERFORM public.assert_admin_caller();
  SELECT is_active INTO old_active FROM public.stations WHERE id = _station_id;
  IF old_active IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: İstasyon yok.'; END IF;
  UPDATE public.stations SET is_active = _active WHERE id = _station_id;
  PERFORM public.write_audit('station.active_changed', 'stations', _station_id::text,
    jsonb_build_object('is_active', old_active), jsonb_build_object('is_active', _active), NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_machine(_station_id uuid, _code text, _name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  PERFORM public.assert_admin_caller();
  INSERT INTO public.machines (station_id, code, name)
  VALUES (_station_id, upper(trim(_code)), trim(_name)) RETURNING id INTO new_id;
  PERFORM public.write_audit('machine.created', 'machines', new_id::text, NULL,
    jsonb_build_object('code', upper(trim(_code)), 'name', trim(_name), 'station_id', _station_id), NULL);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_machine_active(_machine_id uuid, _active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_active boolean;
BEGIN
  PERFORM public.assert_admin_caller();
  SELECT is_active INTO old_active FROM public.machines WHERE id = _machine_id;
  IF old_active IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Makine yok.'; END IF;
  UPDATE public.machines SET is_active = _active WHERE id = _machine_id;
  PERFORM public.write_audit('machine.active_changed', 'machines', _machine_id::text,
    jsonb_build_object('is_active', old_active), jsonb_build_object('is_active', _active), NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_invite_user(_email text, _role public.app_role DEFAULT NULL, _full_name text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid; norm text := lower(trim(_email));
BEGIN
  PERFORM public.assert_admin_caller();
  IF norm = '' OR norm IS NULL THEN RAISE EXCEPTION 'GECERSIZ: E-posta gerekli.'; END IF;
  INSERT INTO public.user_invites (email, role, full_name, invited_by)
  VALUES (norm, _role, _full_name, auth.uid())
  ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name,
    invited_by = EXCLUDED.invited_by, created_at = now()
  RETURNING id INTO new_id;
  PERFORM public.write_audit('user_invite.created', 'user_invites', new_id::text, NULL,
    jsonb_build_object('email', norm, 'role', _role), NULL);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_invite(_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE old_row public.user_invites;
BEGIN
  PERFORM public.assert_admin_caller();
  SELECT * INTO old_row FROM public.user_invites WHERE id = _invite_id;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Davet yok.'; END IF;
  DELETE FROM public.user_invites WHERE id = _invite_id AND accepted_at IS NULL;
  PERFORM public.write_audit('user_invite.revoked', 'user_invites', _invite_id::text,
    to_jsonb(old_row), NULL, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, public.app_role, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_station_scope(uuid, uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_permission_override(uuid, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_user_active(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_station(text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_station_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_machine(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_machine_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_invite_user(text, public.app_role, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_invite(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_set_user_role(uuid, public.app_role, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_station_scope(uuid, uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_permission_override(uuid, text, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_station(text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_station_active(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_machine(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_machine_active(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_invite_user(text, public.app_role, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_invite(uuid) TO authenticated, service_role;

-- 5) DOĞRUDAN TABLO YAZMA HAKLARININ KALDIRILMASI ----------------------------
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_station_scopes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_permission_overrides FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.stations FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.machines FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.role_permissions FROM authenticated;
REVOKE INSERT, DELETE ON public.profiles FROM authenticated;

DROP POLICY IF EXISTS "user_roles_admin_insert" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin_delete" ON public.user_roles;
DROP POLICY IF EXISTS "scopes_admin_insert" ON public.user_station_scopes;
DROP POLICY IF EXISTS "scopes_admin_delete" ON public.user_station_scopes;
DROP POLICY IF EXISTS "overrides_admin_write" ON public.user_permission_overrides;
DROP POLICY IF EXISTS "stations_admin_write" ON public.stations;
DROP POLICY IF EXISTS "machines_admin_write" ON public.machines;
DROP POLICY IF EXISTS "role_permissions_admin_insert" ON public.role_permissions;
DROP POLICY IF EXISTS "role_permissions_admin_delete" ON public.role_permissions;
DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;

-- 6) OKUMA POLİTİKALARININ DARALTILMASI --------------------------------------
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_scoped" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.can_read_directory());

DROP POLICY IF EXISTS "profiles_update_self_name" ON public.profiles;
CREATE POLICY "profiles_update_self_name" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() AND is_active)
  WITH CHECK (
    id = auth.uid()
    AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid())
  );

DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_read_directory());

DROP POLICY IF EXISTS "scopes_select" ON public.user_station_scopes;
CREATE POLICY "scopes_select" ON public.user_station_scopes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.can_read_directory());

DROP POLICY IF EXISTS "overrides_select" ON public.user_permission_overrides;
CREATE POLICY "overrides_select" ON public.user_permission_overrides FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.caller_is_admin());

DROP POLICY IF EXISTS "stations_select" ON public.stations;
CREATE POLICY "stations_select" ON public.stations FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "machines_select" ON public.machines;
CREATE POLICY "machines_select" ON public.machines FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));

DROP POLICY IF EXISTS "settings_select" ON public.app_settings;
CREATE POLICY "settings_select" ON public.app_settings FOR SELECT TO authenticated
  USING (public.caller_is_admin());
DROP POLICY IF EXISTS "settings_admin_write" ON public.app_settings;
CREATE POLICY "settings_admin_write" ON public.app_settings FOR ALL TO authenticated
  USING (public.caller_is_admin()) WITH CHECK (public.caller_is_admin());
REVOKE INSERT, UPDATE ON public.app_settings FROM authenticated;

CREATE POLICY "invites_admin_select" ON public.user_invites FOR SELECT TO authenticated
  USING (public.caller_is_admin());

-- 7) KAYIT AKIŞI: otomatik Admin kaldırıldı, davet esaslı --------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
          CASE WHEN inv.id IS NULL THEN 'Açık kayıt' ELSE 'Davet ile kayıt' END);

  IF inv.id IS NOT NULL THEN
    IF inv.role IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, inv.role)
      ON CONFLICT (user_id, role) DO NOTHING;
      INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_value, reason)
      VALUES (inv.invited_by, 'role.granted', 'user_roles', NEW.id::text,
              jsonb_build_object('role', inv.role), 'Davet ile atanan rol');
    END IF;
    UPDATE public.user_invites
       SET accepted_at = now(), accepted_user_id = NEW.id
     WHERE id = inv.id;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Kurulum ayarı: açık kayıt kapalı
INSERT INTO public.app_settings (key, value) VALUES ('signup_open', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;