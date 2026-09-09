-- ENUMS
CREATE TYPE public.app_role AS ENUM ('grafik','depo','operator','asistan','mudur','patron','muhasebe','admin');

-- PROFILES
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- USER ROLES
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- PERMISSIONS
CREATE TABLE public.permissions (
  code text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'genel'
);
GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.role_permissions (
  role public.app_role NOT NULL,
  permission_code text NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role, permission_code)
);
GRANT SELECT, INSERT, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES public.permissions(code) ON DELETE CASCADE,
  granted boolean NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (user_id, permission_code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permission_overrides TO authenticated;
GRANT ALL ON public.user_permission_overrides TO service_role;
ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

-- STATIONS & MACHINES
CREATE TABLE public.stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stations TO authenticated;
GRANT ALL ON public.stations TO service_role;
ALTER TABLE public.stations ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.machines TO authenticated;
GRANT ALL ON public.machines TO service_role;
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_station_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES public.stations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, station_id)
);
GRANT SELECT, INSERT, DELETE ON public.user_station_scopes TO authenticated;
GRANT ALL ON public.user_station_scopes TO service_role;
ALTER TABLE public.user_station_scopes ENABLE ROW LEVEL SECURITY;

-- AUDIT LOG (append only)
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT SELECT, INSERT ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- APP SETTINGS
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER HELPERS
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT o.granted FROM public.user_permission_overrides o
      WHERE o.user_id = _user_id AND o.permission_code = _permission),
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role = ur.role
      WHERE ur.user_id = _user_id AND rp.permission_code = _permission
    )
  ) AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.is_active);
$$;

CREATE OR REPLACE FUNCTION public.has_station_scope(_user_id uuid, _station_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_station_scopes s WHERE s.user_id = _user_id AND s.station_id = _station_id);
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin');
$$;

-- NEW USER TRIGGER: profile + first user becomes admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  is_first boolean;
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO is_first;
  IF is_first THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
    INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, new_value, reason)
    VALUES (NEW.id, 'role.granted', 'user_roles', NEW.id::text, jsonb_build_object('role','admin'), 'İlk kullanıcı otomatik Admin');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- POLICIES
CREATE POLICY "profiles_select_authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_self_name" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid()));
CREATE POLICY "profiles_admin_update" ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "user_roles_admin_insert" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "user_roles_admin_delete" ON public.user_roles FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "permissions_select" ON public.permissions FOR SELECT TO authenticated USING (true);

CREATE POLICY "role_permissions_select" ON public.role_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "role_permissions_admin_insert" ON public.role_permissions FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "role_permissions_admin_delete" ON public.role_permissions FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "overrides_select" ON public.user_permission_overrides FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));
CREATE POLICY "overrides_admin_write" ON public.user_permission_overrides FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "stations_select" ON public.stations FOR SELECT TO authenticated USING (true);
CREATE POLICY "stations_admin_write" ON public.stations FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "machines_select" ON public.machines FOR SELECT TO authenticated USING (true);
CREATE POLICY "machines_admin_write" ON public.machines FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "scopes_select" ON public.user_station_scopes FOR SELECT TO authenticated USING (true);
CREATE POLICY "scopes_admin_insert" ON public.user_station_scopes FOR INSERT TO authenticated WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "scopes_admin_delete" ON public.user_station_scopes FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE POLICY "audit_read" ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'audit.read') OR actor_id = auth.uid());
CREATE POLICY "audit_insert" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());

CREATE POLICY "settings_select" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_admin_write" ON public.app_settings FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- SEED: permissions
INSERT INTO public.permissions (code, label, category) VALUES
  ('orders.create','Sipariş açma','Sipariş'),
  ('orders.edit_graphics','Grafik düzenleme','Sipariş'),
  ('inventory.receive','Depo kabul','Depo'),
  ('inventory.correct_unassigned','Bağlanmamış kaydı düzeltme','Depo'),
  ('team.manage','Sepet, rezervasyon ve takım','Takım'),
  ('production.release','Üretime alma','Üretim'),
  ('operation.start','Operasyon başlatma','Üretim'),
  ('operation.complete','Operasyon tamamlama','Üretim'),
  ('quality.request','Uyarı/sorun bildirimi','Kalite'),
  ('rework.approve','Rework onayı','Kalite'),
  ('proof.rework.approve','Prova geri dönüş onayı','Prova'),
  ('route.modify','Rota değişikliği','Üretim'),
  ('production.hold','Bekletme','Üretim'),
  ('orders.cancel','Sipariş iptali','Sipariş'),
  ('shipment.confirm','Sevk etme','Sevkiyat'),
  ('billing.decide','Ticari uygunluk kararı','Muhasebe'),
  ('billing.override','Ticari istisna override','Muhasebe'),
  ('accounting.process','Muhasebede işlendi','Muhasebe'),
  ('production.correct','Geçmiş üretim/ölçüm düzeltme','Üretim'),
  ('audit.read','Denetim kaydı okuma','Yönetim'),
  ('admin.configure','Sistem ayarları','Yönetim');

-- SEED: role permissions
INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('grafik','orders.create'),('grafik','orders.edit_graphics'),('grafik','orders.cancel'),
  ('depo','inventory.receive'),('depo','inventory.correct_unassigned'),('depo','quality.request'),
  ('operator','operation.start'),('operator','operation.complete'),('operator','quality.request'),
  ('asistan','orders.create'),('asistan','orders.edit_graphics'),('asistan','inventory.receive'),
  ('asistan','inventory.correct_unassigned'),('asistan','team.manage'),('asistan','production.release'),
  ('asistan','operation.start'),('asistan','operation.complete'),('asistan','quality.request'),
  ('asistan','rework.approve'),('asistan','route.modify'),('asistan','production.hold'),
  ('asistan','orders.cancel'),('asistan','shipment.confirm'),('asistan','billing.decide'),
  ('asistan','production.correct'),('asistan','audit.read'),
  ('mudur','orders.create'),('mudur','orders.edit_graphics'),('mudur','inventory.receive'),
  ('mudur','inventory.correct_unassigned'),('mudur','team.manage'),('mudur','production.release'),
  ('mudur','operation.start'),('mudur','operation.complete'),('mudur','quality.request'),
  ('mudur','rework.approve'),('mudur','proof.rework.approve'),('mudur','route.modify'),
  ('mudur','production.hold'),('mudur','orders.cancel'),('mudur','shipment.confirm'),
  ('mudur','billing.decide'),('mudur','billing.override'),('mudur','production.correct'),('mudur','audit.read'),
  ('patron','audit.read'),
  ('muhasebe','accounting.process'),('muhasebe','audit.read'),
  ('admin','orders.create'),('admin','orders.edit_graphics'),('admin','inventory.receive'),
  ('admin','inventory.correct_unassigned'),('admin','team.manage'),('admin','production.release'),
  ('admin','operation.start'),('admin','operation.complete'),('admin','quality.request'),
  ('admin','rework.approve'),('admin','proof.rework.approve'),('admin','route.modify'),
  ('admin','production.hold'),('admin','orders.cancel'),('admin','shipment.confirm'),
  ('admin','billing.decide'),('admin','billing.override'),('admin','accounting.process'),
  ('admin','production.correct'),('admin','audit.read'),('admin','admin.configure');

-- SEED: stations
INSERT INTO public.stations (code, name, sort_order) VALUES
  ('TORNA','Torna',10),
  ('SOKME','D-Krom / Sökme',20),
  ('BAKIR','Bakır Kaplama',30),
  ('TASLAMA','Taşlama',40),
  ('CFM','CFM / Parlatma',50),
  ('GRAVUR','Gravür',60),
  ('KROM','Krom Kaplama',70),
  ('PROVA','Prova',80);