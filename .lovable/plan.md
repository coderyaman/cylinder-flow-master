# Aşama 2 planı — Silindir kartı, QR ve ziyaret temeli

Aşama 1 (kullanıcı, rol, izin, istasyon, denetim) tamamlandı. Aşama 2, sistemin
temel takip nesnesini kurar: **fiziksel silindir** ve onun **istasyon ziyareti**.

## Ne yapılacak

1. **Silindir ana kaydı**
   - Her fiziksel silindirin kalıcı bir kimliği, kodu, çap/yüzey bilgileri,
     mevcut durumu ve bulunduğu istasyonu olur.
   - Silindir bir takıma (iş/tabaka takımı) bağlanabilir ama takımdan bağımsız yaşar.

2. **QR etiketi**
   - Her silindir için değişmeyen bir QR değeri üretilir ve yazdırılabilir etiket
     görünümü sunulur.
   - QR okutulduğunda doğrudan o silindirin kartı açılır.

3. **Ziyaret yaşam döngüsü**
   - Bir silindir istasyona geldiğinde ziyaret açılır: bekliyor → işlemde → tamamlandı
     (veya iptal/rework).
   - Aynı silindirde aynı anda yalnızca bir açık ziyaret olabilir; sunucu tarafında
     engellenir.
   - Rework, yeni bir operasyon turu olarak ayrı ziyaretle kaydedilir; geçmiş silinmez.

4. **Yetki ve kayıt disiplini**
   - Ziyaret açma/kapama izni, kullanıcının istasyon kapsamına göre sunucuda kontrol
     edilir.
   - Her durum değişikliği, değişiklikle aynı işlem içinde denetim kaydına yazılır.
   - Üretim kayıtları değiştirilemez; düzeltme yeni kayıt olarak eklenir.

5. **Ekranlar**
   - Silindir listesi ve arama, silindir kartı (durum, konum, ziyaret geçmişi),
     istasyon çalışma ekranı (sıradaki silindirler, başlat/bitir), QR okuma.

## Doğrulama

- Ayrı test projesinde API/veritabanı seviyesinde: çift açık ziyaret engeli,
  kapsam dışı istasyonda işlem reddi, denetim kaydının atomikliği, rework turunun
  geçmişi bozmaması.
- Ekran akışı: QR okut → ziyaret başlat → bitir → kartta geçmişte görünmesi.

## Teknik notlar

- Yeni tablolar: `cylinders`, `cylinder_visits` (+ gerekli enum'lar); her tabloda
  RLS, GRANT ve `updated_at` tetikleyicisi.
- Yazma işlemleri Aşama 1'deki desenle `SECURITY DEFINER` RPC'ler üzerinden yapılır;
  istemcinin doğrudan INSERT/UPDATE yetkisi olmaz.
- Veriler sıfırlanmaz; yalnızca yeni migration dosyaları eklenir.

## Ön koşul

Aşama 1 test paketi henüz ayrı bir test projesinde çalıştırılmadı. Aşama 2
geliştirmesine başlamadan önce o ortamın tanımlanması önerilir.
