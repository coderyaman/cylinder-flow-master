CREATE POLICY grafik_pdf_upload ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'grafik-pdf'
    AND public.has_permission(auth.uid(), 'orders.edit_graphics')
  );

CREATE POLICY grafik_pdf_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'grafik-pdf'
    AND public.has_permission(auth.uid(), 'orders.read_graphic_file')
  );