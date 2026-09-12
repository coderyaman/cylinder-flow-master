-- Aşama 6A hazırlığı: operatör okuma kapsamı, rota adımı tamamlanma durumu,
-- yeni imalattan doğan silindir kaydının kökeni.

CREATE OR REPLACE FUNCTION public.can_read_orders()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = auth.uid()
      AND p.is_active
      AND ur.role IN ('grafik','depo','asistan','mudur','patron','admin','operator')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_inventory()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user(auth.uid()) AND (
    public.has_permission(auth.uid(), 'inventory.receive')
    OR public.has_permission(auth.uid(), 'inventory.correct_unassigned')
    OR public.has_permission(auth.uid(), 'team.manage')
    OR public.has_permission(auth.uid(), 'production.release')
    OR public.has_permission(auth.uid(), 'audit.read')
    OR public.has_permission(auth.uid(), 'operation.start')
  );
$$;

ALTER TYPE public.route_step_status ADD VALUE IF NOT EXISTS 'tamamlandi';

CREATE TYPE public.cyl_origin AS ENUM ('kabul', 'yeni_imalat');
ALTER TABLE public.cylinder_receipts
  ADD COLUMN origin public.cyl_origin NOT NULL DEFAULT 'kabul',
  ADD COLUMN measurements_recorded boolean NOT NULL DEFAULT true,
  ADD COLUMN nominal_circumference_mm numeric,
  ADD COLUMN nominal_length_mm numeric;

ALTER TABLE public.cylinder_receipts
  ALTER COLUMN measured_circumference_mm SET DEFAULT 0,
  ALTER COLUMN measured_diameter_mm SET DEFAULT 0,
  ALTER COLUMN measured_length_mm SET DEFAULT 0;