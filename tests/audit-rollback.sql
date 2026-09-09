-- Denetim atomikliği doğrulaması — YALNIZCA ayrı test veritabanında çalıştırılır.
-- Gerçek yönetim fonksiyonu (admin_set_user_role) üzerinden, denetim yazımı
-- kontrollü biçimde başarısız kılınarak geri alma davranışı doğrulanır.
-- Bütün adımlar tek transaction içindedir ve sonunda ROLLBACK edilir.
--
-- Parametreler DO blokları içinde genişletilmediği için blok dışında
-- set_config() ile aktarılır ve bloklarda current_setting() ile okunur.

\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('rgtest.admin_id', :'admin_id', true);
SELECT set_config('rgtest.target_id', :'target_id', true);
SELECT set_config('rgtest.marker', :'marker', true);

-- Ön koşullar: eksik fonksiyon / yetki testi geçirmemeli
DO $$
DECLARE
  admin_id uuid := current_setting('rgtest.admin_id')::uuid;
  target_id uuid := current_setting('rgtest.target_id')::uuid;
BEGIN
  IF to_regprocedure('public.admin_set_user_role(uuid, public.app_role, boolean, text)') IS NULL THEN
    RAISE EXCEPTION 'ON_KOSUL: admin_set_user_role fonksiyonu bulunamadı.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'ON_KOSUL: test yöneticisi admin rolüne sahip değil.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target_id AND role = 'grafik') THEN
    RAISE EXCEPTION 'ON_KOSUL: hedef kullanıcıda grafik rolü zaten var.';
  END IF;
END $$;

-- Denetim yazımını kontrollü olarak başarısız kıl
CREATE FUNCTION public._test_block_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TEST_AUDIT_YAZILAMADI: denetim kaydı kasıtlı olarak engellendi.';
END;
$$;

CREATE TRIGGER _test_block_audit
BEFORE INSERT ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public._test_block_audit();

-- Gerçek istemci bağlamı: authenticated rolü + oturum kimliği
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = :'jwt_claims';

DO $$
DECLARE
  msg text := NULL;
  target_id uuid := current_setting('rgtest.target_id')::uuid;
  marker text := current_setting('rgtest.marker');
BEGIN
  BEGIN
    PERFORM public.admin_set_user_role(target_id, 'grafik'::public.app_role, true, marker);
  EXCEPTION WHEN others THEN
    msg := SQLERRM;
  END;

  IF msg IS NULL THEN
    RAISE EXCEPTION 'BEKLENMEDIK: denetim engelliyken işlem hatasız tamamlandı.';
  END IF;
  IF msg NOT LIKE '%TEST_AUDIT_YAZILAMADI%' THEN
    RAISE EXCEPTION 'BEKLENMEYEN_HATA_TURU: % (yetki/bağlantı hatası testi geçiremez)', msg;
  END IF;
END $$;

RESET role;

-- Geri alma doğrulaması: rol satırı ve BU işleme ait denetim kaydı oluşmamalı.
-- Önceki çalıştırmalardan kalan kayıtlar hata sayılmaz: yalnızca bu çalıştırmanın
-- işleme özel işareti (marker) aranır.
DO $$
DECLARE
  target_id uuid := current_setting('rgtest.target_id')::uuid;
  marker text := current_setting('rgtest.marker');
BEGIN
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target_id AND role = 'grafik') THEN
    RAISE EXCEPTION 'GERI_ALINMADI: rol satırı kalıcı oldu.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.audit_log
     WHERE entity_id = target_id::text AND action = 'role.granted' AND reason = marker
  ) THEN
    RAISE EXCEPTION 'GERI_ALINMADI: denetim kaydı oluştu.';
  END IF;
END $$;

-- Başarı işareti stdout'a yazılır (RAISE NOTICE stderr'e gider, koşucu okumaz).
SELECT 'AUDIT_ROLLBACK_OK' AS sonuc;

ROLLBACK;
