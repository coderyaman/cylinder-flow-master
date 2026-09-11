-- Aynı isteğin tekrarı önceki kabul kaydını döndürür (record alanına atama yerine yerel değişken).
CREATE OR REPLACE FUNCTION public.receive_cylinder(
  _customer_id uuid,
  _measured_circumference_mm numeric,
  _measured_diameter_mm numeric,
  _measured_length_mm numeric,
  _shaft_type public.cyl_shaft_type,
  _surface_state public.cyl_surface_state,
  _usability public.cyl_usability,
  _waybill_no text DEFAULT NULL,
  _received_on date DEFAULT current_date,
  _note text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid; cmd record; cust public.customers; new_id uuid; code text; prior public.cylinder_receipts;
BEGIN
  uid := public.assert_permission('inventory.receive');
  SELECT * INTO cmd FROM public.command_begin(_idempotency_key, 'receive_cylinder',
    jsonb_build_object(
      'customer_id', _customer_id,
      'circumference', _measured_circumference_mm,
      'diameter', _measured_diameter_mm,
      'length', _measured_length_mm,
      'shaft_type', _shaft_type,
      'surface_state', _surface_state,
      'usability', _usability,
      'waybill_no', NULLIF(btrim(COALESCE(_waybill_no,'')),''),
      'received_on', COALESCE(_received_on, current_date),
      'note', NULLIF(btrim(COALESCE(_note,'')),'')));
  IF NOT cmd.is_new THEN
    SELECT * INTO prior FROM public.cylinder_receipts WHERE id = cmd.prior::uuid;
    RETURN jsonb_build_object('id', prior.id, 'cyl_code', prior.cyl_code, 'replayed', true);
  END IF;

  SELECT * INTO cust FROM public.customers WHERE id = _customer_id;
  IF cust.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Müşteri yok.'; END IF;
  IF NOT cust.is_active THEN RAISE EXCEPTION 'MUSTERI_PASIF: Pasif müşteri adına kabul yapılamaz.'; END IF;
  IF _measured_circumference_mm IS NULL OR _measured_circumference_mm <= 0
     OR _measured_diameter_mm IS NULL OR _measured_diameter_mm <= 0
     OR _measured_length_mm IS NULL OR _measured_length_mm <= 0 THEN
    RAISE EXCEPTION 'GECERSIZ: Ölçülen çevre, çap ve boy pozitif olmalıdır.';
  END IF;

  code := 'CYL-' || to_char(COALESCE(_received_on, current_date), 'YYYY') || '-' ||
          lpad(nextval('public.cylinder_code_seq')::text, 5, '0');

  INSERT INTO public.cylinder_receipts (cyl_code, customer_id, waybill_no, received_on,
    measured_circumference_mm, measured_diameter_mm, measured_length_mm,
    shaft_type, surface_state, usability, note, created_by, updated_by)
  VALUES (code, _customer_id, NULLIF(btrim(COALESCE(_waybill_no,'')),''),
    COALESCE(_received_on, current_date),
    _measured_circumference_mm, _measured_diameter_mm, _measured_length_mm,
    _shaft_type, _surface_state, _usability,
    NULLIF(btrim(COALESCE(_note,'')),''), uid, uid)
  RETURNING id INTO new_id;

  INSERT INTO public.cylinder_measurements (receipt_id, circumference_mm, diameter_mm, length_mm,
    source, note, measured_by)
  VALUES (new_id, _measured_circumference_mm, _measured_diameter_mm, _measured_length_mm,
    'kabul', NULLIF(btrim(COALESCE(_note,'')),''), uid);

  PERFORM public.write_audit('cylinder.received', 'cylinder_receipts', new_id::text, NULL,
    jsonb_build_object('cyl_code', code, 'customer_id', _customer_id,
      'circumference', _measured_circumference_mm, 'diameter', _measured_diameter_mm,
      'length', _measured_length_mm), NULL);
  PERFORM public.command_finish(_idempotency_key, new_id::text);

  RETURN jsonb_build_object('id', new_id, 'cyl_code', code, 'replayed', false);
END;
$$;