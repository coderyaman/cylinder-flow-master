-- Aşama 9: Sevkiyat ve arşiv (PRD 14.3 / 14.4).
CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  proof_run_id uuid REFERENCES public.proof_runs(id),
  member_count integer NOT NULL,
  membership_fingerprint text NOT NULL,
  note text,
  shipped_at timestamptz NOT NULL DEFAULT now(),
  shipped_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shipments_team_uniq ON public.shipments(team_id);
CREATE INDEX IF NOT EXISTS shipments_order_idx ON public.shipments(order_id);

CREATE TABLE IF NOT EXISTS public.shipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  receipt_id uuid REFERENCES public.cylinder_receipts(id),
  cyl_code text,
  stage_no integer,
  circumference_mm numeric,
  diameter_mm numeric,
  length_mm numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, team_member_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS shipment_items_member_uniq
  ON public.shipment_items(team_member_id);
CREATE UNIQUE INDEX IF NOT EXISTS shipment_items_receipt_uniq
  ON public.shipment_items(receipt_id) WHERE receipt_id IS NOT NULL;

DO $mig$ BEGIN
  CREATE TYPE public.accounting_status AS ENUM ('bekliyor','islendi');
EXCEPTION WHEN duplicate_object THEN NULL; END $mig$;

CREATE TABLE IF NOT EXISTS public.accounting_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  shipment_id uuid REFERENCES public.shipments(id),
  trigger text NOT NULL,
  status public.accounting_status NOT NULL DEFAULT 'bekliyor',
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processed_by uuid REFERENCES auth.users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_packages_shipment_uniq
  ON public.accounting_packages(shipment_id) WHERE shipment_id IS NOT NULL;

GRANT SELECT ON public.shipments TO authenticated;
GRANT SELECT ON public.shipment_items TO authenticated;
GRANT SELECT ON public.accounting_packages TO authenticated;
GRANT ALL ON public.shipments TO service_role;
GRANT ALL ON public.shipment_items TO service_role;
GRANT ALL ON public.accounting_packages TO service_role;

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipments_select" ON public.shipments;
CREATE POLICY "shipments_select" ON public.shipments FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));
DROP POLICY IF EXISTS "shipment_items_select" ON public.shipment_items;
CREATE POLICY "shipment_items_select" ON public.shipment_items FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));
DROP POLICY IF EXISTS "accounting_packages_select" ON public.accounting_packages;
CREATE POLICY "accounting_packages_select" ON public.accounting_packages FOR SELECT TO authenticated
  USING (public.is_active_user(auth.uid()) AND public.has_any_role(auth.uid()));

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipped_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipped_by uuid REFERENCES auth.users(id);

ALTER TABLE public.cylinder_receipts
  ADD COLUMN IF NOT EXISTS visit_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS visit_closed_reason text;

CREATE OR REPLACE FUNCTION public.guard_no_shipped_operation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE closed timestamptz;
BEGIN
  SELECT c.visit_closed_at INTO closed
    FROM public.team_members m
    JOIN public.cylinder_receipts c ON c.id = m.receipt_id
   WHERE m.id = NEW.team_member_id;
  IF closed IS NOT NULL THEN
    RAISE EXCEPTION 'SEVK_EDILDI: Bu ziyaret sevk edilerek kapatıldı; yeni işlem başlatılamaz.';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS operations_no_shipped ON public.operations;
CREATE TRIGGER operations_no_shipped BEFORE INSERT ON public.operations
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_shipped_operation();

CREATE OR REPLACE FUNCTION public.shipment_gate(_team_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE t public.teams; ord public.orders; gate jsonb; blockers jsonb := '[]'::jsonb;
        b jsonb; shipped_before integer; existing uuid;
BEGIN
  SELECT * INTO t FROM public.teams WHERE id = _team_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Takım yok.'; END IF;
  SELECT * INTO ord FROM public.orders WHERE id = t.order_id;

  gate := public.proof_gate(_team_id);

  FOR b IN SELECT * FROM jsonb_array_elements(gate->'blockers') LOOP
    blockers := blockers || b;
  END LOOP;

  IF NOT (gate->>'approval_valid')::boolean THEN
    blockers := blockers || jsonb_build_object('code','ONAY_YOK',
      'text','Güncel takım için geçerli bir Prova onayı yok.');
  END IF;

  SELECT count(*) INTO shipped_before
    FROM public.shipment_items si
    JOIN public.team_members m ON m.id = si.team_member_id
   WHERE m.team_id = _team_id;
  IF shipped_before > 0 THEN
    blockers := blockers || jsonb_build_object('code','ZATEN_SEVK',
      'text','Bu takımın üyeleri daha önce sevk edilmiş.');
  END IF;

  SELECT id INTO existing FROM public.shipments WHERE team_id = _team_id;

  RETURN jsonb_build_object(
    'team_id', _team_id, 'team_code', t.team_code, 'order_id', ord.id,
    'work_order_no', ord.work_order_no, 'order_name', ord.name,
    'customer', (SELECT name FROM public.customers WHERE id = ord.customer_id),
    'quantity', ord.quantity, 'due_on', ord.due_on,
    'shipment_ready_at', t.shipment_ready_at,
    'approved_run_id', t.approved_run_id,
    'members', gate->'members',
    'blockers', blockers,
    'ready', jsonb_array_length(blockers) = 0 AND existing IS NULL,
    'shipment_id', existing);
END;
$fn$;
REVOKE ALL ON FUNCTION public.shipment_gate(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.shipment_gate(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ship_team(
  _team_id uuid, _note text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE uid uuid; cmd record; t public.teams; ord public.orders; gate jsonb;
        ship_id uuid; cnt integer; pkg_id uuid;
        body text := NULLIF(btrim(COALESCE(_note,'')),'');
        ikey text := COALESCE(_idempotency_key, gen_random_uuid()::text);
BEGIN
  uid := public.assert_permission('shipment.confirm');
  SELECT * INTO cmd FROM public.command_begin(ikey, 'ship_team',
    jsonb_build_object('team', _team_id, 'note', body));
  IF NOT cmd.is_new THEN
    RETURN jsonb_build_object('shipment_id', cmd.prior, 'replayed', true);
  END IF;

  SELECT * INTO t FROM public.teams WHERE id = _team_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Takım yok.'; END IF;
  SELECT * INTO ord FROM public.orders WHERE id = t.order_id FOR UPDATE;

  SELECT id INTO ship_id FROM public.shipments WHERE team_id = _team_id;
  IF ship_id IS NOT NULL THEN
    PERFORM public.command_finish(ikey, ship_id::text);
    RETURN jsonb_build_object('shipment_id', ship_id, 'replayed', true);
  END IF;

  gate := public.shipment_gate(_team_id);
  IF NOT (gate->>'ready')::boolean THEN
    RAISE EXCEPTION 'GECERSIZ: Sevk koşulları sağlanmıyor: %',
      COALESCE((SELECT string_agg(x->>'text', ' ')
                  FROM jsonb_array_elements(gate->'blockers') x), '');
  END IF;

  INSERT INTO public.shipments (order_id, team_id, proof_run_id, member_count,
                                membership_fingerprint, note, shipped_by)
  VALUES (ord.id, t.id, t.approved_run_id,
          (SELECT count(*) FROM public.team_members m WHERE m.team_id = t.id AND m.is_active),
          COALESCE(t.shipment_ready_fingerprint, public.team_proof_fingerprint(t.id)), body, uid)
  RETURNING id INTO ship_id;

  INSERT INTO public.shipment_items (shipment_id, team_member_id, receipt_id, cyl_code,
                                     stage_no, circumference_mm, diameter_mm, length_mm)
  SELECT ship_id, m.id, m.receipt_id, c.cyl_code, m.stage_no,
         c.measured_circumference_mm, c.measured_diameter_mm, c.measured_length_mm
    FROM public.team_members m
    JOIN public.cylinder_receipts c ON c.id = m.receipt_id
   WHERE m.team_id = t.id AND m.is_active;
  GET DIAGNOSTICS cnt = ROW_COUNT;

  UPDATE public.cylinder_receipts c
     SET lifecycle = 'sevk_edildi', visit_closed_at = now(),
         visit_closed_reason = 'Sevk edildi: ' || ord.work_order_no,
         updated_at = now(), updated_by = uid, row_version = c.row_version + 1
   WHERE c.id IN (SELECT si.receipt_id FROM public.shipment_items si
                   WHERE si.shipment_id = ship_id AND si.receipt_id IS NOT NULL);

  UPDATE public.cylinder_reservations r
     SET status = 'birakildi', released_at = now(), released_by = uid,
         release_reason = 'Sevk edildi'
   WHERE r.status = 'aktif'
     AND r.receipt_id IN (SELECT si.receipt_id FROM public.shipment_items si
                           WHERE si.shipment_id = ship_id AND si.receipt_id IS NOT NULL);

  UPDATE public.orders SET shipped_at = now(), shipped_by = uid,
         updated_at = now(), updated_by = uid, row_version = row_version + 1
   WHERE id = ord.id;

  INSERT INTO public.accounting_packages (order_id, shipment_id, trigger, status)
  VALUES (ord.id, ship_id, 'sevk', 'bekliyor')
  ON CONFLICT (shipment_id) WHERE shipment_id IS NOT NULL DO NOTHING
  RETURNING id INTO pkg_id;

  PERFORM public.write_audit('shipment.created', 'shipments', ship_id::text, NULL,
    jsonb_build_object('order_id', ord.id, 'team_id', t.id, 'items', cnt,
      'proof_run_id', t.approved_run_id, 'accounting_package_id', pkg_id), body);

  PERFORM public.command_finish(ikey, ship_id::text);
  RETURN jsonb_build_object('shipment_id', ship_id, 'items', cnt, 'replayed', false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ship_team(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ship_team(uuid, text, text) TO authenticated, service_role;