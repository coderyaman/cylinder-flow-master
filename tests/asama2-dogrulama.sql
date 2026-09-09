-- Aşama 2 doğrulaması: müşteri, sipariş ve grafik kuralları.
-- Tek transaction içinde çalışır ve sonunda ROLLBACK edilir; kalıcı veri bırakmaz.
-- Kullanım:  psql -v admin_id=<uuid> -v jwt_claims='{"sub":"<uuid>","role":"authenticated"}' -f tests/asama2-dogrulama.sql

\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('rgtest.admin_id', :'admin_id', true);

DO $$
DECLARE
  cust uuid; ord uuid; ord2 uuid; msg text; ver integer; res jsonb;
  uid uuid := current_setting('rgtest.admin_id')::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid AND role = 'admin') THEN
    RAISE EXCEPTION 'ON_KOSUL: verilen kullanıcı admin değil.';
  END IF;

  -- 1) Müşteri oluşturma (Admin)
  cust := public.admin_create_customer('DOGRULAMA A.Ş.');
  IF cust IS NULL THEN RAISE EXCEPTION 'HATA: müşteri oluşmadı.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_id = cust::text AND action='customer.created') THEN
    RAISE EXCEPTION 'HATA: müşteri denetim kaydı yok.';
  END IF;

  -- 2) Aynı adla ikinci müşteri engellenmemeli
  PERFORM public.admin_create_customer('DOGRULAMA A.Ş.');

  -- 3) Sipariş açma (Admin varsayılan yetkisi)
  ord := public.create_order(cust, ' 00123 ', 'Doğrulama işi', 4, 600.00, 1200.00,
                             current_date + 10, current_date, 'belirsiz', 'normal',
                             NULL, NULL, 'idem-' || gen_random_uuid()::text);

  -- 4) Aynı müşteride tekrar eden iş emri reddedilmeli (AC-01)
  BEGIN
    PERFORM public.create_order(cust, '00123', 'Kopya', 1, 600, 1200, current_date + 5);
    RAISE EXCEPTION 'HATA: tekrarlı iş emri kabul edildi.';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%IS_EMRI_TEKRAR%' THEN RAISE; END IF;
  END;

  -- 5) Adet <= 0 reddedilmeli (AC-02)
  BEGIN
    PERFORM public.create_order(cust, 'X-1', 'Sıfır adet', 0, 600, 1200, current_date + 5);
    RAISE EXCEPTION 'HATA: adet 0 kabul edildi.';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%GECERSIZ%' THEN RAISE; END IF;
  END;

  -- 6) Tekrar gönderilen istek yeni kayıt üretmemeli
  DECLARE k text := 'idem-' || gen_random_uuid()::text;
  BEGIN
    ord2 := public.create_order(cust, 'IDEM-1', 'Tekrar testi', 2, 600, 1200, current_date + 5,
                                current_date, 'belirsiz', 'normal', NULL, NULL, k);
    IF public.create_order(cust, 'IDEM-1', 'Tekrar testi', 2, 600, 1200, current_date + 5,
                           current_date, 'belirsiz', 'normal', NULL, NULL, k) <> ord2 THEN
      RAISE EXCEPTION 'HATA: aynı işlem anahtarı ikinci kayıt üretti.';
    END IF;
  END;

  -- 7) Sürüm çakışması
  SELECT row_version INTO ver FROM public.orders WHERE id = ord;
  BEGIN
    PERFORM public.update_order(ord, ver + 5, '00123', 'Yeni ad', 4, 600, 1200,
      current_date + 12, 'belirsiz', 'normal');
    RAISE EXCEPTION 'HATA: eski sürümle güncelleme kabul edildi.';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%SURUM_ESKI%' THEN RAISE; END IF;
  END;

  -- 8) Doğru sürümle güncelleme ve denetim kaydı
  ver := public.update_order(ord, ver, '00123', 'Güncellenmiş iş', 5, 610, 1210,
    current_date + 12, 'depoda_mevcut', 'yuksek', 'not', NULL, 'doğrulama');
  IF NOT EXISTS (SELECT 1 FROM public.audit_log WHERE entity_id = ord::text AND action='order.updated') THEN
    RAISE EXCEPTION 'HATA: sipariş güncelleme denetim kaydı yok.';
  END IF;

  -- 9) Grafik durumu
  ver := public.set_graphic_status(ord, ver, 'grafik_hazir');
  IF (SELECT graphic_status FROM public.orders WHERE id = ord) <> 'grafik_hazir' THEN
    RAISE EXCEPTION 'HATA: grafik durumu değişmedi.';
  END IF;

  -- 10) PDF revizyonları: iki yükleme, tek güncel dosya
  res := public.attach_graphic_revision(ord, ord::text || '/a.pdf', 'a.pdf', 1024, 'application/pdf');
  res := public.attach_graphic_revision(ord, ord::text || '/b.pdf', 'b.pdf', 2048, 'application/pdf');
  IF (SELECT count(*) FROM public.graphic_assets WHERE order_id = ord) <> 2 THEN
    RAISE EXCEPTION 'HATA: revizyon geçmişi korunmadı.';
  END IF;
  IF (SELECT count(*) FROM public.graphic_assets WHERE order_id = ord AND is_current) <> 1 THEN
    RAISE EXCEPTION 'HATA: birden fazla güncel dosya var.';
  END IF;
  IF (res->>'revision_no')::int <> 2 THEN RAISE EXCEPTION 'HATA: revizyon numarası artmadı.'; END IF;

  -- 11) PDF olmayan dosya reddedilmeli
  BEGIN
    PERFORM public.attach_graphic_revision(ord, ord::text || '/c.jpg', 'c.jpg', 10, 'image/jpeg');
    RAISE EXCEPTION 'HATA: PDF olmayan dosya kabul edildi.';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%DOSYA_GECERSIZ%' THEN RAISE; END IF;
  END;

  -- 12) Gerekçesiz iptal reddedilmeli
  SELECT row_version INTO ver FROM public.orders WHERE id = ord;
  BEGIN
    PERFORM public.cancel_order(ord, ver, '   ');
    RAISE EXCEPTION 'HATA: gerekçesiz iptal kabul edildi.';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%GECERSIZ%' THEN RAISE; END IF;
  END;

  -- 13) İptal ve sonrasında yazma denemesi
  ver := public.cancel_order(ord, ver, 'Müşteri vazgeçti');
  BEGIN
    PERFORM public.set_graphic_status(ord, ver, 'revize');
    RAISE EXCEPTION 'HATA: iptal sonrası değişiklik kabul edildi.';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%IPTAL_EDILMIS%' THEN RAISE; END IF;
  END;

  -- 14) Pasif müşteriye sipariş açılamaz
  PERFORM public.admin_set_customer_active(cust, false);
  BEGIN
    PERFORM public.create_order(cust, 'PASIF-1', 'Pasif deneme', 1, 600, 1200, current_date + 3);
    RAISE EXCEPTION 'HATA: pasif müşteriye sipariş açıldı.';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%MUSTERI_PASIF%' THEN RAISE; END IF;
  END;
END $$;

SELECT 'ASAMA2_OK' AS sonuc;

ROLLBACK;
