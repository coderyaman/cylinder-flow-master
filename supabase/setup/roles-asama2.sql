-- Aşama 2 rol/izin kurulumu — TEKRARLANABİLİR (idempotent).
-- Boş bir ortamda da, mevcut ortamda da aynı sonucu üretir.
-- Mevcut kişisel izinler (user_permission_overrides) KORUNUR; bu dosya onlara dokunmaz.

-- 1) İzin kodları
INSERT INTO public.permissions (code, label, category) VALUES
  ('orders.edit_all', 'Bütün siparişleri düzenleme', 'siparis')
ON CONFLICT (code) DO NOTHING;

-- 2) Varsayılan rol izinleri: Admin sipariş açar ve bütün siparişleri düzenler.
INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('admin', 'orders.create'),
  ('admin', 'orders.edit_all'),
  ('admin', 'orders.edit_graphics'),
  ('admin', 'orders.cancel'),
  ('admin', 'orders.read_graphic_file'),
  ('grafik', 'orders.create'),
  ('grafik', 'orders.edit_graphics'),
  ('grafik', 'orders.cancel'),
  ('grafik', 'orders.read_graphic_file')
ON CONFLICT DO NOTHING;

-- 3) Asistan ve Müdür için sipariş izinleri rol varsayılanı DEĞİLDİR;
--    plana göre kişiye özel ek yetki olarak verilir.
DELETE FROM public.role_permissions
 WHERE role IN ('asistan', 'mudur')
   AND permission_code IN ('orders.create', 'orders.edit_all', 'orders.edit_graphics',
                           'orders.cancel', 'orders.read_graphic_file');
