-- Restrict every SECURITY DEFINER function in the exposed public schema to signed-in callers.
DO $migration$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn.signature);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn.signature);
  END LOOP;
END
$migration$;

-- Pin the only public function missing an explicit search path.
ALTER FUNCTION public.assert_row_version(integer, integer) SET search_path TO public;

-- Accounting records are writeable only through audited SECURITY DEFINER RPCs.
DROP POLICY IF EXISTS accounting_overrides_rpc_only_insert ON public.accounting_overrides;
CREATE POLICY accounting_overrides_rpc_only_insert ON public.accounting_overrides
  FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS accounting_overrides_rpc_only_update ON public.accounting_overrides;
CREATE POLICY accounting_overrides_rpc_only_update ON public.accounting_overrides
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS accounting_overrides_rpc_only_delete ON public.accounting_overrides;
CREATE POLICY accounting_overrides_rpc_only_delete ON public.accounting_overrides
  FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS accounting_packages_rpc_only_insert ON public.accounting_packages;
CREATE POLICY accounting_packages_rpc_only_insert ON public.accounting_packages
  FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS accounting_packages_rpc_only_update ON public.accounting_packages;
CREATE POLICY accounting_packages_rpc_only_update ON public.accounting_packages
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS accounting_packages_rpc_only_delete ON public.accounting_packages;
CREATE POLICY accounting_packages_rpc_only_delete ON public.accounting_packages
  FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS accounting_processings_rpc_only_insert ON public.accounting_processings;
CREATE POLICY accounting_processings_rpc_only_insert ON public.accounting_processings
  FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS accounting_processings_rpc_only_update ON public.accounting_processings;
CREATE POLICY accounting_processings_rpc_only_update ON public.accounting_processings
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS accounting_processings_rpc_only_delete ON public.accounting_processings;
CREATE POLICY accounting_processings_rpc_only_delete ON public.accounting_processings
  FOR DELETE TO authenticated USING (false);

-- Billing rules remain read-only to clients; future changes must use an authorized audited RPC.
DROP POLICY IF EXISTS billing_rules_rpc_only_insert ON public.billing_rules;
CREATE POLICY billing_rules_rpc_only_insert ON public.billing_rules
  FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS billing_rules_rpc_only_update ON public.billing_rules;
CREATE POLICY billing_rules_rpc_only_update ON public.billing_rules
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS billing_rules_rpc_only_delete ON public.billing_rules;
CREATE POLICY billing_rules_rpc_only_delete ON public.billing_rules
  FOR DELETE TO authenticated USING (false);

-- Allow users to inspect only their own command history; admins may inspect all records.
GRANT SELECT ON public.command_log TO authenticated;
GRANT ALL ON public.command_log TO service_role;
DROP POLICY IF EXISTS command_log_select_actor_or_admin ON public.command_log;
CREATE POLICY command_log_select_actor_or_admin ON public.command_log
  FOR SELECT TO authenticated
  USING (
    actor_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- The graphics bucket is private and all access uses short-lived signed URLs from authenticated server functions.
-- These policies make direct browser access explicitly denied instead of relying only on RLS default-deny.
DROP POLICY IF EXISTS grafik_pdf_direct_select_denied ON storage.objects;
CREATE POLICY grafik_pdf_direct_select_denied ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id <> 'grafik-pdf');
DROP POLICY IF EXISTS grafik_pdf_direct_insert_denied ON storage.objects;
CREATE POLICY grafik_pdf_direct_insert_denied ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'grafik-pdf');
DROP POLICY IF EXISTS grafik_pdf_direct_update_denied ON storage.objects;
CREATE POLICY grafik_pdf_direct_update_denied ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id <> 'grafik-pdf')
  WITH CHECK (bucket_id <> 'grafik-pdf');
DROP POLICY IF EXISTS grafik_pdf_direct_delete_denied ON storage.objects;
CREATE POLICY grafik_pdf_direct_delete_denied ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id <> 'grafik-pdf');