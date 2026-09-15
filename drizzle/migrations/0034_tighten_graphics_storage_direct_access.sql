DROP POLICY IF EXISTS grafik_pdf_direct_select_denied ON storage.objects;
CREATE POLICY grafik_pdf_direct_select_denied ON storage.objects
  FOR SELECT TO authenticated
  USING (false);

DROP POLICY IF EXISTS grafik_pdf_direct_insert_denied ON storage.objects;
CREATE POLICY grafik_pdf_direct_insert_denied ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS grafik_pdf_direct_update_denied ON storage.objects;
CREATE POLICY grafik_pdf_direct_update_denied ON storage.objects
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS grafik_pdf_direct_delete_denied ON storage.objects;
CREATE POLICY grafik_pdf_direct_delete_denied ON storage.objects
  FOR DELETE TO authenticated
  USING (false);