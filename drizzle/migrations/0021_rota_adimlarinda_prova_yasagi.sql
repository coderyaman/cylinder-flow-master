-- Prova takım düzeyinde tek operasyondur; silindir rotasına adım olarak eklenemez.
CREATE OR REPLACE FUNCTION public.guard_no_cyl_proof_step()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.stations s
              WHERE s.id = NEW.station_id AND s.code = 'PROVA') THEN
    RAISE EXCEPTION 'GECERSIZ: Prova takım düzeyinde yürütülür; silindir rotasına Prova adımı eklenemez.';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS route_steps_no_proof ON public.route_steps;
CREATE TRIGGER route_steps_no_proof
  BEFORE INSERT ON public.route_steps
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_cyl_proof_step();