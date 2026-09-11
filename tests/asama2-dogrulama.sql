-- Aşama 2 doğrulaması: müşteri, sipariş ve grafik kuralları.
-- Tek transaction içinde çalışır ve sonunda ROLLBACK edilir; kalıcı veri bırakmaz.
-- Yönetici kimliği e-postadan bulunur; ayrı parametre gerekmez.
-- Çalıştırma: veritabanı yönetici bağlantısıyla bu dosyayı yürütün
-- (SET ROLE authenticated yetkisi gerekir).

BEGIN;

SELECT set_config(
  'rgtest.admin_id',
  (SELECT p.id::text FROM public.profiles p
     JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'admin'
    WHERE p.is_active
    ORDER BY p.created_at
    LIMIT 1),
  true
);

-- Gerçek istemci bağlamı: authenticated rolü + oturum kimliği
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', current_setting('rgtest.admin_id'), 'role', 'authenticated')::text,
  true
);
SET LOCAL role authenticated;




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

  -- 10) PDF revizyonları yeni akışla: sunucu yükleme oturumu + kesinleştirme
  DECLARE s1 jsonb; s2 jsonb; s3 jsonb;
  BEGIN
    s1 := private.graphic_upload_target(uid, ord, 0);
    res := private.attach_graphic_revision_v3(uid, (s1->>'session_id')::uuid, 'a.pdf', 1024);
    s2 := private.graphic_upload_target(uid, ord, 1);
    res := private.attach_graphic_revision_v3(uid, (s2->>'session_id')::uuid, 'b.pdf', 2048);
    IF (SELECT count(*) FROM public.graphic_assets WHERE order_id = ord) <> 2 THEN
      RAISE EXCEPTION 'HATA: revizyon geçmişi korunmadı.';
    END IF;
    IF (SELECT count(*) FROM public.graphic_assets WHERE order_id = ord AND is_current) <> 1 THEN
      RAISE EXCEPTION 'HATA: birden fazla güncel dosya var.';
    END IF;
    IF (res->>'revision_no')::int <> 2 THEN RAISE EXCEPTION 'HATA: revizyon numarası artmadı.'; END IF;

    -- 10b) Aynı oturumun tekrarı önceki sonucu döndürmeli, yeni revizyon üretmemeli
    res := private.attach_graphic_revision_v3(uid, (s2->>'session_id')::uuid, 'b.pdf', 2048);
    IF (res->>'replayed')::boolean IS NOT TRUE OR (res->>'revision_no')::int <> 2 THEN
      RAISE EXCEPTION 'HATA: tekrar gönderim önceki sonucu döndürmedi.';
    END IF;
    IF (SELECT count(*) FROM public.graphic_assets WHERE order_id = ord) <> 2 THEN
      RAISE EXCEPTION 'HATA: tekrar gönderim yeni revizyon oluşturdu.';
    END IF;

    -- 10c) Eski revizyon beklentisiyle yükleme hedefi çakışma vermeli
    BEGIN
      PERFORM private.graphic_upload_target(uid, ord, 0);
      RAISE EXCEPTION 'HATA: eski revizyon beklentisi kabul edildi.';
    EXCEPTION WHEN others THEN
      IF SQLERRM NOT LIKE '%REVIZYON_CAKISMASI%' THEN RAISE; END IF;
    END;

    -- 11) Temizliğe alınan oturum kesinleştirilememeli; kayıtlı dosya korunmalı
    s3 := private.graphic_upload_target(uid, ord, 2);
    UPDATE public.graphic_upload_sessions
       SET created_at = now() - interval '2 hours' WHERE id = (s3->>'session_id')::uuid;
    PERFORM private.graphic_claim_orphans(60);
    BEGIN
      PERFORM private.attach_graphic_revision_v3(uid, (s3->>'session_id')::uuid, 'c.pdf', 1024);
      RAISE EXCEPTION 'HATA: temizliğe alınan oturum kesinleştirildi.';
    EXCEPTION WHEN others THEN
      IF SQLERRM NOT LIKE '%OTURUM_TEMIZLENDI%' THEN RAISE; END IF;
    END;
    IF EXISTS (
      SELECT 1 FROM public.graphic_upload_sessions s
      JOIN public.graphic_assets g ON g.storage_path = s.storage_path
      WHERE s.cleanup_claimed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'HATA: kayıtlı dosyanın oturumu temizliğe alındı.';
    END IF;

    -- 11b) Geçersiz boyut reddedilmeli
    BEGIN
      PERFORM private.attach_graphic_revision_v3(uid,
        (private.graphic_upload_target(uid, ord, 2)->>'session_id')::uuid, 'd.pdf', 0);
      RAISE EXCEPTION 'HATA: geçersiz boyut kabul edildi.';
    EXCEPTION WHEN others THEN
      IF SQLERRM NOT LIKE '%DOSYA_GECERSIZ%' THEN RAISE; END IF;
    END;
  END;

  -- 11c) Aynı işlem anahtarı, yalnızca boy/çevre/not/öncelik değişse bile reddedilmeli
  DECLARE k2 text := 'idem2-' || gen_random_uuid()::text; v integer;
  BEGIN
    SELECT row_version INTO v FROM public.orders WHERE id = ord;
    v := public.update_order(ord, v, '00123', 'Güncellenmiş iş', 5, 610, 1210,
      current_date + 12, 'depoda_mevcut', 'yuksek', 'not', NULL, 'doğrulama', k2);
    IF public.update_order(ord, v - 1, '00123', 'Güncellenmiş iş', 5, 610, 1210,
      current_date + 12, 'depoda_mevcut', 'yuksek', 'not', NULL, 'doğrulama', k2) <> v THEN
      RAISE EXCEPTION 'HATA: aynı istek tekrarı önceki sonucu döndürmedi.';
    END IF;
    BEGIN
      PERFORM public.update_order(ord, v, '00123', 'Güncellenmiş iş', 5, 999, 1999,
        current_date + 12, 'depoda_mevcut', 'acil', 'başka not', NULL, 'doğrulama', k2);
      RAISE EXCEPTION 'HATA: aynı anahtar farklı içerikle kabul edildi.';
    EXCEPTION WHEN others THEN
      IF SQLERRM NOT LIKE '%ANAHTAR_CAKISMASI%' THEN RAISE; END IF;
    END;
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
