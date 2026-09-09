# Rotagravür MES — Ürün Anlayışı ve Geliştirme Planı

## 1. Ürün nedir?

Rotagravür silindir işleyen bir fabrikanın üretim yönetim çekirdeği. Takip edilen ana nesne sipariş değil, **fiziksel silindirin fabrika ziyareti**. Her silindir kabulden sevkiyata kadar tekil bir ziyaret kimliği ve QR ile izlenir; operatör QR ile işi açar, makinede başlatır, ölçü ve yapılan işleri kaydeder, tamamlar. Sipariş durumu bu gerçekleşen operasyonlardan hesaplanır — tersi değil.

## 2. Çözülen problem

- Bir siparişin silindirlerinin nerede olduğu sahada arayarak öğreniliyor.
- Kuyruk süresi ile işlem süresi, duruşlar, rework nedenleri kayıtlı değil.
- Mil Çakma, Ana Kaplama gibi ek işçilikler muhasebede kayboluyor; iç hata kaynaklı ücretsiz rework müşteri revizyonundan ayrılmıyor.
- Takımın hangi üyesinin sevkiyatı beklettiği görünmüyor.

## 3. Roller (PRD §4)

Grafik (sipariş/PDF), Depo (kabul, teknik kart), Operatör (istasyon kapsamlı başlat/tamamla), Üretim Asistanı (sepet, takım, release, rework onayı, sevk), Üretim Müdürü (Asistan + prova geri dönüş onayı, ticari override), Patron (okuma/rapor), Muhasebe (ücretli/ücretsiz kalemler, "İşlendi"), Admin (konfigürasyon, kontrollü düzeltme — audit'e dokunamaz).

## 4. Zincirin mantığı

Sipariş (müşteri + iş emri no, adet = silindir ihtiyacı) → Sepet ve rezervasyon → Takım (slot + üyelik geçmişi) → Üye bazlı rota sürümü → İstasyon kuyruğu → Operasyon (tur) → Yapılan iş kalemleri + ölçümler → Uyarı/bloke/rework (yeni tur, eski kayıt korunur) → Takım seviyesinde Prova → Tam takım sevkiyatı (ziyaret kapanır) → Muhasebe (İşlendi) → Arşiv.

## 5. Asla ihlal edilmeyecek kurallar (özet)

Bir silindir tek müşteriye ait ve aynı anda tek siparişe rezerve; hazır olmak üretime başlamak değil; kısmi release var, kısmi sevkiyat yok; QR okutmak süre başlatmaz; tamamlanan operasyon operatörce değiştirilemez; kademe yalnız Taşlama'da atanır ve aktif takımda tekildir; Gravür üstüne Gravür yok (Sökme→Bakır→Taşlama→CFM→Gravür); PDF'siz Gravür başlamaz ama hazırlık başlar; uyarı durdurmaz, bloke durdurur; rework eski operasyonu değiştirmez; prova onayı sevkiyat değil, sevkiyat muhasebe değil, "İşlendi" fatura değil; gerçekleşmiş üretim ve audit silinmez.

## 6. Mimari (Lovable + GitHub + Supabase)

- **Veri:** Supabase Postgres, tüm tablolarda RLS. Yetki `has_permission(user, permission, station?)` gibi SECURITY DEFINER fonksiyonlarla; roller ayrı `user_roles` tablosunda, asla profil/metadata üzerinde değil.
- **İş kuralları sunucuda:** Başlat/Tamamla/Rezerve/Sevk gibi komutlar tek transaction içinde çalışan sunucu fonksiyonları (TanStack server functions + Postgres fonksiyonları), `client_request_id` ile idempotent. Frontend kontrolleri yalnızca kullanıcı deneyimi içindir.
- **Değişmezlik:** `audit_log` yalnızca INSERT; UPDATE/DELETE politikası yok. Düzeltmeler yeni kayıt olarak yazılır.
- **Dosya:** Sipariş PDF'leri private Storage bucket'ında, role göre imzalı erişim, her yükleme/görüntüleme audit'e.
- **Canlı:** Kanban ve kuyruklar Supabase Realtime ile.
- **Şema:** Her değişiklik migration dosyası olarak repoda; şema ile kod aynı sürümü temsil eder.
- **Arayüz:** Türkçe, tablet öncelikli operatör ekranları + masaüstü yönetim ekranları; modül bazlı sayfa yapısı, tek dev bileşen yok.

## 7. Aşamalar ve somut çıktıları

1. **Kimlik, roller, istasyon yetkileri, audit altyapısı** (bu planın onayı sonrası yapılacak tek aşama).
2. Müşteri, sipariş, grafik durumları ve PDF akışı.
3. Depo kabulü, silindir teknik kartı, ölçüm geçmişi, QR yaşam döngüsü.
4. Sepet, rezervasyon, planlanan imalat, takım ve üyelik geçmişi.
5. Rota motoru, kısmi release, istasyon kuyrukları.
6. Operatör tablet akışı ve dinamik istasyon formları.
7. Toplu Sökme, uyarı/bloke, kalite, rework, silindir değiştirme.
8. Takım provası ve Müdür karar akışı.
9. Tam takım sevkiyatı, ziyaret kapanışı, arşiv.
10. İşçilikler, faturalandırma kuralları, Muhasebe ekranı.
11. Makine, vardiya, duruş, Kanban, dashboard, rapor, bildirim, arama.
12. Kabul kriterleri, eşzamanlılık testleri, uçtan uca senaryolar (SEN-01…06).

Her aşama sonunda durur, çalışanları/tabloları/RLS'i/kabul kriterlerini raporlar, onay beklerim.

## 8. Aşama 1 kapsamı (onay bekleyen)

**Kullanılacak PRD bölümleri:** 4 (roller ve teknik izinler), 20 (audit ve veri güvenilirliği), 21 (admin ve konfigürasyon), 22.1/22.3 (Identity & Configuration alanı), 24 (komut sözleşmesi ve idempotency temeli), 25.4 (AC-87, AC-88).

**Yapılacaklar**
- Lovable Cloud'u etkinleştirme (Supabase veritabanı, giriş, dosya alanı).
- Tablolar: `profiles`, `roles`/`user_roles` (8 rol), `permissions` + `role_permissions`, `user_permission_overrides`, `stations`, `machines`, `user_station_scopes`, `audit_log`, `app_settings`.
- `has_role`, `has_permission`, `has_station_scope` SECURITY DEFINER fonksiyonları; tüm tablolarda GRANT + RLS politikaları.
- Yalnızca-INSERT audit; her yetki değişikliği audit'e yazılır.
- Giriş/çıkış akışı, oturum korumalı alan, rolüne göre boş modül iskeleti içeren ana menü.
- Admin ekranları: kullanıcı listesi ve rol atama, kullanıcı bazlı ek izin, istasyon ve makine tanımları, istasyon yetkisi atama.

**Kabul kriterleri (bu aşamada doğrulanacak)**
- AC-88: Yetkisiz kullanıcı doğrudan sorgu/API ile başka rolün verisine erişemez; kısıt sunucuda uygulanır.
- AC-87 temeli: Yetki/tanım değişikliğinde eski değer, yeni değer, neden ve kullanıcı audit'te; hiçbir rol audit'i silemez veya güncelleyemez.
- Menü gizleme dışında gerçek veritabanı düzeyinde yetki testi: her rol için en az bir olumlu ve bir olumsuz erişim denemesi.
- Kullanıcının kendi profil alanları yetki kaynağı değildir.

**Bu aşamada yapılmayacaklar:** Sipariş, silindir, rota, operasyon tabloları; tanıtım sayfası; sahte verili dashboard.

## 9. Aşama 1'i etkileyen açık kararlar

- İlk Admin kullanıcısı: Sisteme kayıt olan ilk hesabı Admin yapıp diğer rolleri Admin'in atamasını öneriyorum.
- Kullanıcı oluşturma: Kayıt e-posta/şifre ile açık mı olacak, yoksa yalnızca Admin mi kullanıcı açacak?
- Başlangıç istasyon listesi: Torna, D-Krom/Sökme, Bakır Kaplama, Taşlama, CFM/Parlatma, Gravür, Krom Kaplama, Prova ile başlanacak; makine adları sonra Admin ekranından girilecek.

Bu üç madde dışında Aşama 1'i engelleyen belirsizlik yok.
