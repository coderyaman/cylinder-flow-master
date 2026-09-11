-- Aşama 4: Sepet, rezervasyon, planlanan yeni imalat ve takım oluşturma.
-- Takım oluşturmak üretimi BAŞLATMAZ. Planlanan ek işler yapılmış operasyon değildir.

CREATE TYPE public.cyl_lifecycle AS ENUM
  ('depoda', 'kontrol_bekliyor', 'tamir_bekliyor', 'uretimde', 'sevk_edildi', 'hurda');

ALTER TABLE public.cylinder_receipts
  ADD COLUMN lifecycle public.cyl_lifecycle NOT NULL DEFAULT 'depoda';

CREATE TYPE public.planned_op AS ENUM
  ('cevre_dusurme', 'cevre_yukseltme', 'ana_kaplama', 'mil_cakma', 'yuzuk_degisimi', 'tamir');

CREATE TYPE public.cart_item_kind AS ENUM ('mevcut', 'yeni_imalat');
CREATE TYPE public.reservation_status AS ENUM ('aktif', 'birakildi');
CREATE TYPE public.cart_status AS ENUM ('taslak', 'takim_olusturuldu');

CREATE SEQUENCE public.team_code_seq;

CREATE TABLE public.order_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  status public.cart_status NOT NULL DEFAULT 'taslak',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

CREATE TABLE public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.order_carts(id),
  kind public.cart_item_kind NOT NULL,
  receipt_id uuid REFERENCES public.cylinder_receipts(id),
  planned_ops public.planned_op[] NOT NULL DEFAULT '{}',
  note text,
  removed_at timestamptz,
  removed_by uuid REFERENCES auth.users(id),
  removed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
CREATE INDEX cart_items_cart_idx ON public.cart_items(cart_id);

CREATE TABLE public.cylinder_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.cylinder_receipts(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  cart_item_id uuid NOT NULL REFERENCES public.cart_items(id),
  status public.reservation_status NOT NULL DEFAULT 'aktif',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  released_at timestamptz,
  released_by uuid REFERENCES auth.users(id),
  release_reason text
);
-- Aynı silindir aynı anda yalnızca tek siparişe ayrılabilir.
CREATE UNIQUE INDEX cylinder_reservations_one_active
  ON public.cylinder_reservations(receipt_id) WHERE status = 'aktif';
CREATE INDEX cylinder_reservations_order_idx ON public.cylinder_reservations(order_id);

CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_code text NOT NULL UNIQUE,
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  cart_item_id uuid NOT NULL REFERENCES public.cart_items(id),
  kind public.cart_item_kind NOT NULL,
  receipt_id uuid REFERENCES public.cylinder_receipts(id),
  planned_ops public.planned_op[] NOT NULL DEFAULT '{}',
  sequence_no integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid REFERENCES auth.users(id),
  removed_at timestamptz,
  removed_by uuid REFERENCES auth.users(id)
);
CREATE INDEX team_members_team_idx ON public.team_members(team_id);

GRANT SELECT ON public.order_carts TO authenticated;
GRANT SELECT ON public.cart_items TO authenticated;
GRANT SELECT ON public.cylinder_reservations TO authenticated;
GRANT SELECT ON public.teams TO authenticated;
GRANT SELECT ON public.team_members TO authenticated;
GRANT ALL ON public.order_carts TO service_role;
GRANT ALL ON public.cart_items TO service_role;
GRANT ALL ON public.cylinder_reservations TO service_role;
GRANT ALL ON public.teams TO service_role;
GRANT ALL ON public.team_members TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.team_code_seq TO service_role;

ALTER TABLE public.order_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cylinder_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_carts_select" ON public.order_carts
  FOR SELECT TO authenticated USING (public.can_read_orders() OR public.can_read_inventory());
CREATE POLICY "cart_items_select" ON public.cart_items
  FOR SELECT TO authenticated USING (public.can_read_orders() OR public.can_read_inventory());
CREATE POLICY "cylinder_reservations_select" ON public.cylinder_reservations
  FOR SELECT TO authenticated USING (public.can_read_orders() OR public.can_read_inventory());
CREATE POLICY "teams_select" ON public.teams
  FOR SELECT TO authenticated USING (public.can_read_orders() OR public.can_read_inventory());
CREATE POLICY "team_members_select" ON public.team_members
  FOR SELECT TO authenticated USING (public.can_read_orders() OR public.can_read_inventory());

CREATE TRIGGER order_carts_updated_at BEFORE UPDATE ON public.order_carts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sepeti getirir/oluşturur. Sipariş açık olmalıdır.
CREATE OR REPLACE FUNCTION public.cart_ensure(_order_id uuid, _uid uuid)
RETURNS public.order_carts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ord public.orders; c public.order_carts;
BEGIN
  SELECT * INTO ord FROM public.orders WHERE id = _order_id;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sipariş yok.'; END IF;
  IF ord.closure_status = 'iptal' THEN RAISE EXCEPTION 'IPTAL_EDILMIS: İptal edilmiş siparişe sepet hazırlanamaz.'; END IF;
  SELECT * INTO c FROM public.order_carts WHERE order_id = _order_id FOR UPDATE;
  IF c.id IS NULL THEN
    INSERT INTO public.order_carts (order_id, created_by, updated_by)
    VALUES (_order_id, _uid, _uid) RETURNING * INTO c;
  END IF;
  RETURN c;
END;
$$;
REVOKE ALL ON FUNCTION public.cart_ensure(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cart_ensure(uuid, uuid) TO service_role;

-- Mevcut silindiri sepete ekler ve rezervasyon oluşturur.
CREATE OR REPLACE FUNCTION public.cart_add_existing(
  _order_id uuid, _receipt_id uuid,
  _planned_ops public.planned_op[] DEFAULT '{}',
  _idempotency_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; c public.order_carts; ord public.orders;
        rec public.cylinder_receipts; item_id uuid;
BEGIN
  uid := public.assert_permission('team.manage');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'cart_add_existing',
    jsonb_build_object('order_id', _order_id, 'receipt_id', _receipt_id,
                       'planned_ops', to_jsonb(COALESCE(_planned_ops, '{}'::public.planned_op[]))));
  IF NOT cmd.is_new THEN RETURN cmd.prior::uuid; END IF;

  SELECT * INTO ord FROM public.orders WHERE id = _order_id;
  c := public.cart_ensure(_order_id, uid);

  SELECT * INTO rec FROM public.cylinder_receipts WHERE id = _receipt_id FOR UPDATE;
  IF rec.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Silindir kaydı yok.'; END IF;
  IF rec.customer_id <> ord.customer_id THEN
    RAISE EXCEPTION 'GECERSIZ: Silindir başka müşteriye ait.';
  END IF;
  IF rec.status = 'iptal' THEN RAISE EXCEPTION 'GECERSIZ: İptal edilmiş kabul kaydı seçilemez.'; END IF;
  IF rec.lifecycle <> 'depoda' THEN
    RAISE EXCEPTION 'GECERSIZ: Silindir depoda uygun durumda değil (%).', rec.lifecycle;
  END IF;
  IF rec.usability <> 'kullanilabilir' THEN
    RAISE EXCEPTION 'GECERSIZ: Silindir kullanılabilir olarak işaretlenmemiş.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cylinder_reservations
              WHERE receipt_id = _receipt_id AND status = 'aktif') THEN
    RAISE EXCEPTION 'REZERVE: Silindir başka bir siparişe ayrılmış.';
  END IF;

  INSERT INTO public.cart_items (cart_id, kind, receipt_id, planned_ops, created_by)
  VALUES (c.id, 'mevcut', _receipt_id, COALESCE(_planned_ops, '{}'), uid)
  RETURNING id INTO item_id;

  INSERT INTO public.cylinder_reservations (receipt_id, order_id, cart_item_id, created_by)
  VALUES (_receipt_id, _order_id, item_id, uid);

  PERFORM public.write_audit('cart.existing_added', 'cart_items', item_id::text, NULL,
    jsonb_build_object('order_id', _order_id, 'receipt_id', _receipt_id,
                       'cyl_code', rec.cyl_code, 'planned_ops', to_jsonb(COALESCE(_planned_ops,'{}'))), NULL);
  PERFORM public.command_finish(_idempotency_key, item_id::text);
  RETURN item_id;
END;
$$;

-- Planlanan yeni imalat ihtiyacı. Fiziksel stok veya CYL/QR OLUŞTURMAZ.
CREATE OR REPLACE FUNCTION public.cart_add_planned(
  _order_id uuid, _planned_ops public.planned_op[] DEFAULT '{}',
  _note text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; c public.order_carts; item_id uuid;
BEGIN
  uid := public.assert_permission('team.manage');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'cart_add_planned',
    jsonb_build_object('order_id', _order_id,
      'planned_ops', to_jsonb(COALESCE(_planned_ops, '{}'::public.planned_op[])),
      'note', NULLIF(btrim(COALESCE(_note,'')),'')));
  IF NOT cmd.is_new THEN RETURN cmd.prior::uuid; END IF;

  c := public.cart_ensure(_order_id, uid);
  INSERT INTO public.cart_items (cart_id, kind, planned_ops, note, created_by)
  VALUES (c.id, 'yeni_imalat', COALESCE(_planned_ops, '{}'),
          NULLIF(btrim(COALESCE(_note,'')),''), uid)
  RETURNING id INTO item_id;

  PERFORM public.write_audit('cart.planned_added', 'cart_items', item_id::text, NULL,
    jsonb_build_object('order_id', _order_id,
      'planned_ops', to_jsonb(COALESCE(_planned_ops,'{}'))), NULL);
  PERFORM public.command_finish(_idempotency_key, item_id::text);
  RETURN item_id;
END;
$$;

-- Planlanan ek işleri günceller (yapılmış operasyon kaydı değildir).
CREATE OR REPLACE FUNCTION public.cart_set_item_ops(
  _item_id uuid, _planned_ops public.planned_op[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; old_row public.cart_items;
BEGIN
  uid := public.assert_permission('team.manage');
  SELECT * INTO old_row FROM public.cart_items WHERE id = _item_id FOR UPDATE;
  IF old_row.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sepet satırı yok.'; END IF;
  IF old_row.removed_at IS NOT NULL THEN RAISE EXCEPTION 'GECERSIZ: Sepetten çıkarılmış satır değiştirilemez.'; END IF;

  UPDATE public.cart_items SET planned_ops = COALESCE(_planned_ops, '{}') WHERE id = _item_id;
  UPDATE public.team_members SET planned_ops = COALESCE(_planned_ops, '{}')
   WHERE cart_item_id = _item_id AND is_active;

  PERFORM public.write_audit('cart.ops_changed', 'cart_items', _item_id::text,
    jsonb_build_object('planned_ops', to_jsonb(old_row.planned_ops)),
    jsonb_build_object('planned_ops', to_jsonb(COALESCE(_planned_ops,'{}'))), NULL);
END;
$$;

-- Sepetten çıkarma: rezervasyon bırakılır, geçmiş korunur.
CREATE OR REPLACE FUNCTION public.cart_remove_item(
  _item_id uuid, _reason text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; it public.cart_items;
BEGIN
  uid := public.assert_permission('team.manage');
  SELECT * INTO it FROM public.cart_items WHERE id = _item_id FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sepet satırı yok.'; END IF;
  IF it.removed_at IS NOT NULL THEN RETURN; END IF;

  UPDATE public.cart_items
     SET removed_at = now(), removed_by = uid,
         removed_reason = NULLIF(btrim(COALESCE(_reason,'')),'')
   WHERE id = _item_id;

  UPDATE public.cylinder_reservations
     SET status = 'birakildi', released_at = now(), released_by = uid,
         release_reason = NULLIF(btrim(COALESCE(_reason,'')),'')
   WHERE cart_item_id = _item_id AND status = 'aktif';

  UPDATE public.team_members
     SET is_active = false, removed_at = now(), removed_by = uid
   WHERE cart_item_id = _item_id AND is_active;

  PERFORM public.write_audit('cart.item_removed', 'cart_items', _item_id::text,
    to_jsonb(it), NULL, _reason);
END;
$$;

-- Takım oluşturma: üretimi BAŞLATMAZ.
CREATE OR REPLACE FUNCTION public.create_team(
  _order_id uuid, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; ord public.orders; c public.order_carts;
        team_id uuid; code text; total integer; i integer := 0; r record; prior_team public.teams;
BEGIN
  uid := public.assert_permission('team.manage');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'create_team',
    jsonb_build_object('order_id', _order_id));
  IF NOT cmd.is_new THEN
    SELECT * INTO prior_team FROM public.teams WHERE id = cmd.prior::uuid;
    RETURN jsonb_build_object('id', prior_team.id, 'team_code', prior_team.team_code, 'replayed', true);
  END IF;

  SELECT * INTO ord FROM public.orders WHERE id = _order_id;
  IF ord.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Sipariş yok.'; END IF;
  IF ord.closure_status = 'iptal' THEN RAISE EXCEPTION 'IPTAL_EDILMIS: İptal edilmiş siparişe takım kurulamaz.'; END IF;
  IF EXISTS (SELECT 1 FROM public.teams WHERE order_id = _order_id) THEN
    RAISE EXCEPTION 'TAKIM_VAR: Bu siparişin takımı zaten oluşturulmuş.';
  END IF;

  SELECT * INTO c FROM public.order_carts WHERE order_id = _order_id FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'GECERSIZ: Sepet boş.'; END IF;

  SELECT count(*) INTO total FROM public.cart_items
   WHERE cart_id = c.id AND removed_at IS NULL;
  IF total < ord.quantity THEN
    RAISE EXCEPTION 'EKSIK_ADET: Sepet sipariş adedini karşılamıyor (% / %).', total, ord.quantity;
  END IF;

  code := 'TAKIM-' || to_char(now(), 'YYYY') || '-' ||
          lpad(nextval('public.team_code_seq')::text, 4, '0');
  INSERT INTO public.teams (team_code, order_id, created_by)
  VALUES (code, _order_id, uid) RETURNING id INTO team_id;

  FOR r IN SELECT * FROM public.cart_items
            WHERE cart_id = c.id AND removed_at IS NULL ORDER BY created_at LOOP
    i := i + 1;
    INSERT INTO public.team_members (team_id, cart_item_id, kind, receipt_id, planned_ops,
      sequence_no, added_by)
    VALUES (team_id, r.id, r.kind, r.receipt_id, r.planned_ops, i, uid);
  END LOOP;

  UPDATE public.order_carts SET status = 'takim_olusturuldu', updated_by = uid WHERE id = c.id;

  PERFORM public.write_audit('team.created', 'teams', team_id::text, NULL,
    jsonb_build_object('order_id', _order_id, 'team_code', code, 'member_count', i), NULL);
  PERFORM public.command_finish(_idempotency_key, team_id::text);
  RETURN jsonb_build_object('id', team_id, 'team_code', code, 'replayed', false);
END;
$$;

-- Takım kurulduktan sonra üye eklemek: üretim başlamadığı sürece mümkündür.
CREATE OR REPLACE FUNCTION public.team_sync_new_items(_order_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; t public.teams; c public.order_carts; r record; n integer := 0; maxseq integer;
BEGIN
  uid := public.assert_permission('team.manage');
  SELECT * INTO t FROM public.teams WHERE order_id = _order_id;
  IF t.id IS NULL THEN RETURN 0; END IF;
  SELECT * INTO c FROM public.order_carts WHERE order_id = _order_id;
  SELECT COALESCE(max(sequence_no), 0) INTO maxseq FROM public.team_members WHERE team_id = t.id;

  FOR r IN SELECT ci.* FROM public.cart_items ci
            WHERE ci.cart_id = c.id AND ci.removed_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.team_members tm
                               WHERE tm.cart_item_id = ci.id AND tm.is_active)
            ORDER BY ci.created_at LOOP
    maxseq := maxseq + 1; n := n + 1;
    INSERT INTO public.team_members (team_id, cart_item_id, kind, receipt_id, planned_ops,
      sequence_no, added_by)
    VALUES (t.id, r.id, r.kind, r.receipt_id, r.planned_ops, maxseq, uid);
    PERFORM public.write_audit('team.member_added', 'team_members', r.id::text, NULL,
      jsonb_build_object('team_id', t.id, 'cart_item_id', r.id), NULL);
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.cart_add_existing(uuid, uuid, public.planned_op[], text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cart_add_existing(uuid, uuid, public.planned_op[], text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cart_add_planned(uuid, public.planned_op[], text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cart_add_planned(uuid, public.planned_op[], text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cart_set_item_ops(uuid, public.planned_op[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cart_set_item_ops(uuid, public.planned_op[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.cart_remove_item(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cart_remove_item(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_team(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_team(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.team_sync_new_items(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.team_sync_new_items(uuid) TO authenticated, service_role;