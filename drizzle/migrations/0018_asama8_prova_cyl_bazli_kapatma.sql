-- Prova takım operasyonudur: CYL bazlı Prova operasyonu başlatılamaz.
CREATE OR REPLACE FUNCTION public.guard_no_cyl_proof_operation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.stations s
              WHERE s.id = NEW.station_id AND s.code = 'PROVA') THEN
    RAISE EXCEPTION 'GECERSIZ: Prova takım operasyonudur; silindir bazlı Prova başlatılamaz.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operations_no_cyl_proof ON public.operations;
CREATE TRIGGER operations_no_cyl_proof
  BEFORE INSERT ON public.operations
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_cyl_proof_operation();
