CREATE TABLE public.ai_gateway_access_state (model text PRIMARY KEY, reason text NOT NULL, blocked_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.ai_gateway_access_state TO service_role;
REVOKE ALL ON public.ai_gateway_access_state FROM anon, authenticated;
ALTER TABLE public.ai_gateway_access_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_access_service_only ON public.ai_gateway_access_state TO service_role USING (true) WITH CHECK (true);