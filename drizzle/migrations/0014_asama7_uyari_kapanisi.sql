CREATE OR REPLACE FUNCTION public.op_ack_note(_note_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE uid uuid;
BEGIN
  uid := public.assert_permission('quality.request');
  UPDATE public.operation_notes
     SET acknowledged_at = now(), acknowledged_by = uid
   WHERE id = _note_id AND acknowledged_at IS NULL;

  -- Uyarı kaydı "Kontrol Edildi" ile kapanır; bloke kayıtları yalnızca yönetici kararıyla kapanır.
  UPDATE public.quality_issues
     SET status = 'karar_verildi',
         resolved_at = now()
   WHERE note_id = _note_id
     AND severity = 'uyari'
     AND resolved_at IS NULL;

  PERFORM public.write_audit('operation.note_acked', 'operation_notes', _note_id::text,
    NULL, NULL, NULL);
END;
$$;