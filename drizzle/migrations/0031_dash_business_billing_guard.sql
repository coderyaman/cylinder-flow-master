CREATE OR REPLACE FUNCTION public.dash_business_billing(_t0 timestamptz, _t1 timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bill jsonb := jsonb_build_object('faturalandirilabilir', 0, 'faturalandirilmayacak', 0, 'karar_bekliyor', 0);
  o record;
  raw jsonb;
  arr jsonb;
  it jsonb;
  b text;
BEGIN
  FOR o IN
    SELECT DISTINCT ap.order_id
      FROM public.accounting_packages ap
      JOIN public.orders ord ON ord.id = ap.order_id
     WHERE (ord.shipped_at >= _t0 AND ord.shipped_at < _t1)
        OR (ord.cancelled_at >= _t0 AND ord.cancelled_at < _t1)
  LOOP
    raw := public.accounting_items(o.order_id);
    IF raw IS NULL THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(raw) = 'array' THEN
      arr := raw;
    ELSIF jsonb_typeof(raw) = 'object' AND jsonb_typeof(COALESCE(raw->'items', 'null'::jsonb)) = 'array' THEN
      arr := raw->'items';
    ELSE
      CONTINUE;
    END IF;
    FOR it IN SELECT jsonb_array_elements(arr) LOOP
      b := it->>'billing';
      IF b IS NULL OR NOT (bill ? b) THEN
        b := 'karar_bekliyor';
      END IF;
      bill := jsonb_set(bill, ARRAY[b], to_jsonb(COALESCE((bill->>b)::int, 0) + 1));
    END LOOP;
  END LOOP;
  RETURN bill;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dash_business_billing(timestamptz, timestamptz) TO authenticated, service_role;
