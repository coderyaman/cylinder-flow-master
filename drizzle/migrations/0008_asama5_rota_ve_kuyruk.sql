-- Aşama 5: Rota önizleme, üretime alma ve istasyon kuyrukları.
-- Rota önizlemesi üretimi BAŞLATMAZ. Üretime alma yalnızca İLK gerekli adımı kuyruğa bırakır.

-- (A) Aşama 4 küçük düzeltme: Tamir Bekliyor adaylar, yetkili "tamir" işini
-- planladığında seçilebilir. Kullanılabilir/üretime hazır sayılmaz.
CREATE OR REPLACE FUNCTION public.cart_add_existing(
  _order_id uuid, _receipt_id uuid,
  _planned_ops public.planned_op[] DEFAULT '{}',
  _idempotency_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; c public.order_carts; ord public.orders;
        rec public.cylinder_receipts; item_id uuid; ops public.planned_op[];
BEGIN
  uid := public.assert_permission('team.manage');
  ops := COALESCE(_planned_ops, '{}'::public.planned_op[]);
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'cart_add_existing',
    jsonb_build_object('order_id', _order_id, 'receipt_id', _receipt_id,
                       'planned_ops', to_jsonb(ops)));
  IF NOT cmd.is_new THEN RETURN cmd.prior::uuid; END IF;

  SELECT * INTO ord FROM public.orders WHERE id = _order_id;
  c := public.cart_ensure(_order_id, uid);

  SELECT * INTO rec FROM public.cylinder_receipts WHERE id = _receipt_id FOR UPDATE;
  IF rec.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Silindir kaydı yok.'; END IF;
  IF rec.customer_id <> ord.customer_id THEN
    RAISE EXCEPTION 'GECERSIZ: Silindir başka müşteriye ait.';
  END IF;
  IF rec.status = 'iptal' THEN RAISE EXCEPTION 'GECERSIZ: İptal edilmiş kabul kaydı seçilemez.'; END IF;

  IF rec.lifecycle = 'tamir_bekliyor' THEN
    IF NOT ('tamir' = ANY(ops)) THEN
      RAISE EXCEPTION 'GECERSIZ: Tamir bekleyen silindir ancak Tamir işi planlanarak seçilebilir.';
    END IF;
  ELSIF rec.lifecycle <> 'depoda' THEN
    RAISE EXCEPTION 'GECERSIZ: Silindir depoda uygun durumda değil (%).', rec.lifecycle;
  ELSIF rec.usability <> 'kullanilabilir' THEN
    RAISE EXCEPTION 'GECERSIZ: Silindir kullanılabilir olarak işaretlenmemiş.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.cylinder_reservations
              WHERE receipt_id = _receipt_id AND status = 'aktif') THEN
    RAISE EXCEPTION 'REZERVE: Silindir başka bir siparişe ayrılmış.';
  END IF;

  INSERT INTO public.cart_items (cart_id, kind, receipt_id, planned_ops, created_by)
  VALUES (c.id, 'mevcut', _receipt_id, ops, uid)
  RETURNING id INTO item_id;

  INSERT INTO public.cylinder_reservations (receipt_id, order_id, cart_item_id, created_by)
  VALUES (_receipt_id, _order_id, item_id, uid);

  PERFORM public.write_audit('cart.existing_added', 'cart_items', item_id::text, NULL,
    jsonb_build_object('order_id', _order_id, 'receipt_id', _receipt_id,
      'cyl_code', rec.cyl_code, 'lifecycle', rec.lifecycle,
      'planned_ops', to_jsonb(ops)), NULL);
  PERFORM public.command_finish(_idempotency_key, item_id::text);
  RETURN item_id;
END;
$$;

-- (B) Rota modeli
CREATE TYPE public.route_plan_status AS ENUM ('taslak', 'yururlukte', 'superseded');
CREATE TYPE public.route_step_status AS ENUM ('planlandi', 'kuyrukta', 'atlandi', 'superseded');

ALTER TABLE public.team_members
  ADD COLUMN released_at timestamptz,
  ADD COLUMN released_by uuid REFERENCES auth.users(id);

CREATE TABLE public.route_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  version integer NOT NULL,
  status public.route_plan_status NOT NULL DEFAULT 'yururlukte',
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
CREATE INDEX route_plans_member_idx ON public.route_plans(team_member_id);
CREATE UNIQUE INDEX route_plans_one_current
  ON public.route_plans(team_member_id) WHERE status = 'yururlukte';

CREATE TABLE public.route_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.route_plans(id),
  seq integer NOT NULL,
  station_id uuid NOT NULL REFERENCES public.stations(id),
  op_label text NOT NULL,
  round_no integer NOT NULL DEFAULT 1,
  skipped boolean NOT NULL DEFAULT false,
  skip_reason text,
  status public.route_step_status NOT NULL DEFAULT 'planlandi',
  queued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX route_steps_plan_idx ON public.route_steps(plan_id);
CREATE INDEX route_steps_queue_idx ON public.route_steps(station_id) WHERE status = 'kuyrukta';

GRANT SELECT ON public.route_plans TO authenticated;
GRANT SELECT ON public.route_steps TO authenticated;
GRANT ALL ON public.route_plans TO service_role;
GRANT ALL ON public.route_steps TO service_role;

ALTER TABLE public.route_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "route_plans_select" ON public.route_plans
  FOR SELECT TO authenticated USING (public.can_read_orders() OR public.can_read_inventory());
CREATE POLICY "route_steps_select" ON public.route_steps
  FOR SELECT TO authenticated USING (public.can_read_orders() OR public.can_read_inventory());

-- (C) Başlangıç şablonu önerisi. Değişmez teknik reçete DEĞİLDİR; yetkili düzenler.
CREATE OR REPLACE FUNCTION public.route_suggest(_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.team_members; rec public.cylinder_receipts;
        out_steps jsonb := '[]'::jsonb; i integer := 0; torna_ops text[] := '{}';
        st record; op public.planned_op; bakirli boolean := false;
BEGIN
  SELECT * INTO m FROM public.team_members WHERE id = _member_id;
  IF m.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Takım üyesi yok.'; END IF;
  IF m.receipt_id IS NOT NULL THEN
    SELECT * INTO rec FROM public.cylinder_receipts WHERE id = m.receipt_id;
    bakirli := rec.surface_state = 'bakirli';
  END IF;

  FOREACH op IN ARRAY m.planned_ops LOOP
    IF op IN ('cevre_dusurme','cevre_yukseltme','mil_cakma','yuzuk_degisimi','tamir') THEN
      torna_ops := torna_ops || op::text;
    END IF;
  END LOOP;

  IF m.kind = 'yeni_imalat' THEN
    SELECT * INTO st FROM public.stations WHERE code = 'TORNA';
    i := i + 1;
    out_steps := out_steps || jsonb_build_object('seq', i, 'station_id', st.id,
      'station_code', st.code, 'station_name', st.name,
      'op_label', 'Yeni İmalat', 'skipped', false, 'skip_reason', NULL);
  ELSIF array_length(torna_ops, 1) IS NOT NULL THEN
    SELECT * INTO st FROM public.stations WHERE code = 'TORNA';
    i := i + 1;
    out_steps := out_steps || jsonb_build_object('seq', i, 'station_id', st.id,
      'station_code', st.code, 'station_name', st.name,
      'op_label', array_to_string(torna_ops, ', '), 'skipped', false, 'skip_reason', NULL);
  END IF;

  FOR st IN SELECT * FROM public.stations
             WHERE code IN ('SOKME','BAKIR','TASLAMA','CFM','GRAVUR','KROM') AND is_active
             ORDER BY sort_order LOOP
    i := i + 1;
    out_steps := out_steps || jsonb_build_object('seq', i, 'station_id', st.id,
      'station_code', st.code, 'station_name', st.name,
      'op_label', st.name,
      'skipped', (m.kind = 'mevcut' AND bakirli AND st.code IN ('SOKME','BAKIR')),
      'skip_reason', CASE WHEN (m.kind = 'mevcut' AND bakirli AND st.code IN ('SOKME','BAKIR'))
                          THEN 'Yüzey bakırlı kabul edildi (gerekçeyi doğrulayın)' END);
  END LOOP;

  RETURN jsonb_build_object('member_id', _member_id, 'kind', m.kind, 'steps', out_steps);
END;
$$;
REVOKE ALL ON FUNCTION public.route_suggest(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.route_suggest(uuid) TO authenticated, service_role;

-- (D) Rota planını kaydet. Yeni sürüm önceki bekleyen adımları SUPERSEDED yapar.
CREATE OR REPLACE FUNCTION public.route_save_plan(
  _member_id uuid, _steps jsonb, _reason text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; m public.team_members; prev public.route_plans;
        plan_id uuid; v integer; s jsonb; i integer := 0;
BEGIN
  uid := public.assert_permission('team.manage');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'route_save_plan',
    jsonb_build_object('member_id', _member_id, 'steps', _steps,
                       'reason', NULLIF(btrim(COALESCE(_reason,'')),'')));
  IF NOT cmd.is_new THEN RETURN cmd.prior::uuid; END IF;

  SELECT * INTO m FROM public.team_members WHERE id = _member_id FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Takım üyesi yok.'; END IF;
  IF NOT m.is_active THEN RAISE EXCEPTION 'GECERSIZ: Pasif üyeye rota kaydedilemez.'; END IF;
  IF jsonb_typeof(_steps) <> 'array' OR jsonb_array_length(_steps) = 0 THEN
    RAISE EXCEPTION 'GECERSIZ: Rota en az bir adım içermelidir.';
  END IF;

  SELECT * INTO prev FROM public.route_plans
   WHERE team_member_id = _member_id AND status = 'yururlukte' FOR UPDATE;
  IF prev.id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.route_steps
                WHERE plan_id = prev.id AND status = 'kuyrukta') THEN
      RAISE EXCEPTION 'URETIMDE: Kuyrukta adımı olan üyenin rotası bu aşamada değiştirilemez.';
    END IF;
    UPDATE public.route_steps SET status = 'superseded'
     WHERE plan_id = prev.id AND status = 'planlandi';
    UPDATE public.route_plans SET status = 'superseded' WHERE id = prev.id;
  END IF;

  SELECT COALESCE(max(version), 0) + 1 INTO v FROM public.route_plans WHERE team_member_id = _member_id;
  INSERT INTO public.route_plans (team_member_id, version, status, reason, created_by)
  VALUES (_member_id, v, 'yururlukte', NULLIF(btrim(COALESCE(_reason,'')),''), uid)
  RETURNING id INTO plan_id;

  FOR s IN SELECT * FROM jsonb_array_elements(_steps) LOOP
    i := i + 1;
    IF COALESCE((s->>'skipped')::boolean, false)
       AND NULLIF(btrim(COALESCE(s->>'skip_reason','')),'') IS NULL THEN
      RAISE EXCEPTION 'GECERSIZ: Atlanan adım için gerekçe zorunludur.';
    END IF;
    INSERT INTO public.route_steps (plan_id, seq, station_id, op_label, skipped, skip_reason, status)
    VALUES (plan_id, i, (s->>'station_id')::uuid,
      COALESCE(NULLIF(btrim(COALESCE(s->>'op_label','')),''), 'İşlem'),
      COALESCE((s->>'skipped')::boolean, false),
      NULLIF(btrim(COALESCE(s->>'skip_reason','')),''),
      CASE WHEN COALESCE((s->>'skipped')::boolean, false) THEN 'atlandi'::public.route_step_status
           ELSE 'planlandi'::public.route_step_status END);
  END LOOP;

  PERFORM public.write_audit('route.plan_saved', 'route_plans', plan_id::text,
    CASE WHEN prev.id IS NOT NULL THEN jsonb_build_object('prev_plan', prev.id, 'prev_version', prev.version) END,
    jsonb_build_object('member_id', _member_id, 'version', v, 'steps', _steps), _reason);
  PERFORM public.command_finish(_idempotency_key, plan_id::text);
  RETURN plan_id;
END;
$$;
REVOKE ALL ON FUNCTION public.route_save_plan(uuid, jsonb, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.route_save_plan(uuid, jsonb, text, text) TO authenticated, service_role;

-- (E) Üretime alma: yalnızca İLK gerekli adım kuyruğa girer. Tekrar çağrı ikinci kayıt oluşturmaz.
CREATE OR REPLACE FUNCTION public.release_to_production(
  _member_ids uuid[], _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; mid uuid; m public.team_members; ord public.orders;
        rec public.cylinder_receipts; plan public.route_plans; step public.route_steps;
        results jsonb := '[]'::jsonb; reason text; ok boolean;
BEGIN
  uid := public.assert_permission('production.release');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'release_to_production',
    jsonb_build_object('member_ids', to_jsonb(_member_ids)));
  IF NOT cmd.is_new THEN RETURN jsonb_build_object('replayed', true, 'result', cmd.prior::jsonb); END IF;

  FOREACH mid IN ARRAY COALESCE(_member_ids, '{}'::uuid[]) LOOP
    reason := NULL; ok := false;
    SELECT * INTO m FROM public.team_members WHERE id = mid FOR UPDATE;
    IF m.id IS NULL THEN reason := 'Üye bulunamadı.';
    ELSIF NOT m.is_active THEN reason := 'Üye takımdan çıkarılmış.';
    ELSIF m.released_at IS NOT NULL THEN reason := 'Zaten üretime alınmış.';
    ELSE
      SELECT o.* INTO ord FROM public.orders o
        JOIN public.teams t ON t.order_id = o.id WHERE t.id = m.team_id;
      IF ord.closure_status = 'iptal' THEN reason := 'Sipariş iptal edilmiş.'; END IF;

      IF reason IS NULL AND m.kind = 'mevcut' THEN
        SELECT * INTO rec FROM public.cylinder_receipts WHERE id = m.receipt_id;
        IF rec.id IS NULL THEN reason := 'Silindir kaydı yok.';
        ELSIF rec.status = 'iptal' THEN reason := 'Silindir kabul kaydı iptal edilmiş.';
        ELSIF rec.customer_id <> ord.customer_id THEN reason := 'Silindir başka müşteriye ait.';
        ELSIF rec.lifecycle NOT IN ('depoda','tamir_bekliyor') THEN
          reason := 'Silindir depoda değil.';
        ELSIF rec.lifecycle = 'tamir_bekliyor' AND NOT ('tamir' = ANY(m.planned_ops)) THEN
          reason := 'Tamir bekleyen silindir için tamir işi planlanmamış.';
        ELSIF NOT EXISTS (SELECT 1 FROM public.cylinder_reservations
                           WHERE receipt_id = m.receipt_id AND order_id = ord.id AND status = 'aktif') THEN
          reason := 'Aktif rezervasyon yok.';
        END IF;
      END IF;

      IF reason IS NULL THEN
        SELECT * INTO plan FROM public.route_plans
         WHERE team_member_id = mid AND status = 'yururlukte' FOR UPDATE;
        IF plan.id IS NULL THEN reason := 'Yürürlükte rota yok.';
        ELSE
          SELECT * INTO step FROM public.route_steps
           WHERE plan_id = plan.id AND status = 'planlandi' ORDER BY seq LIMIT 1 FOR UPDATE;
          IF step.id IS NULL THEN reason := 'Kuyruğa bırakılacak adım yok.'; END IF;
        END IF;
      END IF;

      IF reason IS NULL THEN
        UPDATE public.route_steps SET status = 'kuyrukta', queued_at = now() WHERE id = step.id;
        UPDATE public.team_members SET released_at = now(), released_by = uid WHERE id = mid;
        IF m.kind = 'mevcut' THEN
          UPDATE public.cylinder_receipts SET lifecycle = 'uretimde', updated_by = uid
           WHERE id = m.receipt_id;
        END IF;
        PERFORM public.write_audit('production.released', 'team_members', mid::text, NULL,
          jsonb_build_object('order_id', ord.id, 'step_id', step.id,
                             'station_id', step.station_id, 'op_label', step.op_label), NULL);
        ok := true;
      END IF;
    END IF;

    results := results || jsonb_build_object('member_id', mid, 'released', ok, 'reason', reason);
  END LOOP;

  PERFORM public.command_finish(_idempotency_key, results::text);
  RETURN jsonb_build_object('replayed', false, 'result', results);
END;
$$;
REVOKE ALL ON FUNCTION public.release_to_production(uuid[], text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.release_to_production(uuid[], text) TO authenticated, service_role;
