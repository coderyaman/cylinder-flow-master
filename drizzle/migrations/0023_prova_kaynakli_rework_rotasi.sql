-- Prova'da tespit edilen hatalarda rework, yeniden hazırlama döngüsüyle (D-Krom/Sökme) başlar.
CREATE OR REPLACE FUNCTION public.rework_suggest(_issue_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE iss public.quality_issues; m public.team_members; dcode text; start_code text;
        st record; i integer := 0; steps jsonb := '[]'::jsonb; ret_label text := NULL;
BEGIN
  PERFORM public.assert_permission('rework.approve');
  SELECT * INTO iss FROM public.quality_issues WHERE id = _issue_id;
  IF iss.id IS NULL THEN RAISE EXCEPTION 'BULUNAMADI: Kayıt yok.'; END IF;
  SELECT * INTO m FROM public.team_members WHERE id = iss.team_member_id;
  SELECT code INTO dcode FROM public.stations WHERE id = iss.detected_station_id;

  -- Gravür ve Prova hatalarında doğrudan aynı noktaya dönülmez; yeniden hazırlama döngüsü uygulanır.
  start_code := CASE WHEN dcode IN ('GRAVUR','PROVA') THEN 'SOKME' ELSE dcode END;

  FOR st IN
    SELECT s.* FROM public.stations s
     WHERE s.is_active
       AND s.sort_order >= (SELECT sort_order FROM public.stations WHERE code = start_code)
       AND s.code IN ('SOKME','BAKIR','TASLAMA','CFM','GRAVUR','KROM','TORNA')
     ORDER BY s.sort_order
  LOOP
    i := i + 1;
    steps := steps || jsonb_build_object('seq', i, 'station_id', st.id,
      'station_code', st.code, 'station_name', st.name,
      'op_label', CASE WHEN st.code = start_code THEN st.name || ' (tekrar işlem)' ELSE st.name END,
      'skipped', false, 'skip_reason', NULL);
    IF ret_label IS NULL AND st.code <> start_code THEN ret_label := st.name; END IF;
  END LOOP;

  RETURN jsonb_build_object('issue_id', _issue_id, 'member_id', m.id,
    'detected_station', dcode, 'start_station', start_code,
    'gravure_loop', dcode IN ('GRAVUR','PROVA'), 'return_point', ret_label,
    'responsibility', iss.responsibility, 'billable', iss.billable, 'steps', steps);
END;
$fn$;