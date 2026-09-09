# Aşama 2 — Müşteri, Sipariş ve Grafik Birimi akışı

Aşama 1 durumu: **uygulandı, ayrı test ortamında doğrulama bekliyor.** Test paketi
yazıldı ve güvenlik kilitleri eklendi, ancak izole test projesi tanımlı olmadığı için
hiçbir test çalıştırılmadı; sonuç olmadan "tamamlandı" denmeyecek.

Kimlik modeli PRD'de kesinleşmiştir ve bu aşamada dokunulmaz: silindir kimliği ve QR
ziyaret bazlıdır, bu aşamanın kapsamı dışındadır. Depo kabulü, QR, sepet/takım, rota,
operatör ekranları ve rework kendi aşamalarında gelir.

## Dayanak PRD bölümleri

- 4 — Roller ve yetkiler (`orders.create`, `orders.edit_graphics`, `admin.configure`)
- 5.1 — Sipariş kartı alanları ve durum sözlükleri
- 5.2 — Grafik iş akışı, PDF ve dosya güvenilirliği kuralları
- 21.1 — Admin müşteri yönetimi (firma adı, aktif/pasif)
- 22.3 / 22.4 — Customer, Order, GraphicAsset alanları; `UNIQUE(müşteri, iş emri no)`
- 23.1 — Siparişin ayrı durum eksenleri
- 25.1 — AC-01, AC-02 kabul kriterleri
- 27.1 — Aşama sırası: alan modeli → giriş ve hazırlık

## Kabul kriterleri

- AC-01: Aynı müşteri + aynı iş emri numarasıyla ikinci sipariş reddedilir; farklı
  müşteri aynı numarayı kullanabilir.
- AC-02: Termin boş ya da adet sıfır/negatifse sipariş kaydedilmez, alan hatası görünür.
- Grafik durumu "Grafik Hazır" olması hiçbir şekilde üretime alma anlamına gelmez;
  üretime alma ayrı bir aşamanın ayrı komutudur.
- Sipariş başına tek güncel PDF görünür; eski revizyonlar silinmez.
- Yetkisiz kullanıcı arayüz gizlense de sunucudan sipariş açamaz/PDF değiştiremez.

## Kapsam

### 1. Admin müşteri yönetimi
- Firma adı ve aktif/pasif. Müşteri kodu/not V1'de opsiyonel, bu aşamada eklenmez.
- Pasif müşteri yeni siparişte seçilemez; geçmiş siparişleri bozulmaz.
- Yalnızca `admin.configure` yetkisi olan kullanıcı ekler/düzenler; her değişiklik audit'e girer.

### 2. Rol bazlı sipariş/grafik yetkileri
- `orders.create`: Grafik; Asistan/Müdür/Admin ek yetkiyle.
- `orders.edit_graphics`: grafik durumu ve PDF yönetimi.
- Okuma: Grafik, Depo, Asistan, Müdür, Patron, Admin genel sipariş durumunu görür;
  Muhasebe ticari havuzu görür; Operatör yalnızca ilgili işi/istasyonu.
- Bütün kontroller sunucuda; arayüz gizleme tek koruma değildir.

### 3. Sipariş kartı
Alanlar: firma (aktif müşteri listesinden, serbest metin yok), iş emri no (müşteri
içinde benzersiz), işin adı, silindir adedi (pozitif tam sayı — silindir ihtiyacı;
renk satırı açılmaz), nominal çevre, boy, sipariş tarihi, termin (zorunlu),
grafik durumu, silindir/klişe durumu, öncelik, genel/kritik not.

- İş emri no normalize edilir (baş/son boşluk temizlenir); baştaki sıfırlar korunur,
  sayıya çevrilmez.
- Üretim durumu bu aşamada girilmez; sonraki aşamalarda operasyonlardan türetilir.
- Sipariş listesi: müşteri, durum, termin ve öncelik filtreleri; gecikme göstergesi.
- Düzenleme: takım yokken ve üretim başlamamışken Grafik kendi siparişini düzenler.
  Takım/üretim kavramları henüz yok; bu aşamada alan `üretim başlamadı` kabul edilir
  ve sonraki aşamada kısıt eklenecek şekilde sunucu kontrolü tek noktada tutulur.

### 4. Grafik iş akışı ve PDF
- Grafik durumları: Dosya Bekleniyor → Renk Ayrımı Yapılıyor → Müşteri Onayı Bekleniyor
  → Revize Bekleniyor → Grafik Hazır. Geçişler serbest yönlüdür (revizeye dönüş olağan),
  her geçiş audit'e yazılır.
- Silindir/Klişe durumu: Durum Belirsiz, Depoda Mevcut, Müşteriden Silindir Bekleniyor,
  Yeni İmalat Gerekli, Kısmen Mevcut / Kısmen İmalat. Bu alan yalnızca beyandır;
  fiili adetler sonraki aşamada depo verisinden gelir.
- PDF: özel (public olmayan) dosya alanına yüklenir. Sipariş başına tek `is_current`
  revizyon; yeni yükleme eskisini silmez, revizyon numarasını artırır.
- Revizyon geçmişi görünür: kim, ne zaman, dosya adı, revizyon no.
- Dosyayı yalnızca yetkili roller indirir; bağlantı süreli imzalı olarak üretilir.
- "Grafik Hazır" bir üretim tetikleyicisi değildir; ekranda da bu açıkça yazılır.

## Teknik bölüm

Tablolar (hepsinde `created_at/by`, `updated_at/by`, RLS, GRANT, `updated_at` trigger):

- `customers(name, is_active)` — `UNIQUE(lower(name))`.
- `orders(customer_id, work_order_no, normalized_work_order_no, name, quantity,
  nominal_circumference_mm, target_length_mm, ordered_on, due_on, graphic_status,
  supply_status, priority, note, critical_note)`
  - `UNIQUE(customer_id, normalized_work_order_no)`
  - `CHECK(quantity > 0)`, `due_on NOT NULL`, ölçüler için pozitiflik kontrolü
  - Enum'lar: `graphic_status`, `supply_status`, `order_priority`
- `graphic_assets(order_id, revision_no, storage_path, filename, byte_size, checksum,
  uploaded_by, uploaded_at, is_current)`
  - `UNIQUE(order_id, revision_no)`, `UNIQUE(order_id) WHERE is_current`
  - Silme yok; yalnızca yeni revizyon.

Sunucu kontrolleri (Aşama 1 deseni — istemcinin doğrudan INSERT/UPDATE yetkisi yok,
her yazma `SECURITY DEFINER` RPC üzerinden ve audit ile aynı transaction'da):

- `admin_create_customer`, `admin_set_customer_active`
- `create_order`, `update_order`, `set_graphic_status`, `attach_graphic_revision`
- Her RPC: aktif hesap + izin + (varsa) müşteri aktifliği kontrolü, ardından
  `write_audit` ile eski/yeni değer kaydı. Audit yazılamazsa değişiklik geri alınır.
- Tekillik ihlali kullanıcıya anlaşılır hata olarak döner (`IS_EMRI_TEKRAR`),
  eşzamanlı iki istekte de veritabanı kısıtı son sözü söyler.

Durum geçişleri:

```text
graphic_status: dosya_bekleniyor ↔ renk_ayrimi ↔ musteri_onayi ↔ revize ↔ grafik_hazir
supply_status : belirsiz | depoda_mevcut | silindir_bekleniyor | yeni_imalat | kismi
(üretim durumu bu aşamada YOK — sonraki aşamalarda operasyonlardan türetilir)
```

## Hata ve istisna senaryoları

- Aynı müşteride tekrarlanan iş emri no → red (eşzamanlı istekte de tek kayıt).
- Termin boş / adet ≤ 0 / negatif ölçü → red, alan bazlı hata.
- Pasif veya var olmayan müşteri ile sipariş → red.
- Yetkisiz kullanıcının API'den sipariş açma / PDF değiştirme denemesi → red.
- Aynı siparişe eşzamanlı iki PDF yüklemesi → tek `is_current` kalır, diğeri revizyon
  olarak saklanır.
- Bozuk/boş dosya veya izin verilmeyen tür → red; kayıt oluşmaz.
- Müşteri pasifleştirildiğinde mevcut siparişler okunur ve düzenlenebilir kalır.

## Test planı (ayrı test ortamında)

- AC-01, AC-02 ve eşzamanlı çift sipariş denemesi.
- Rol matrisi: her rol için sipariş açma/okuma/PDF değiştirme API denemeleri.
- Audit: her sipariş ve grafik değişikliği için eski/yeni değerli tek kayıt; denetim
  yazılamazsa değişikliğin geri alınması.
- PDF: yükleme, revizyon artışı, tek güncel dosya, eski revizyonun korunması,
  yetkisiz indirme denemesinin reddi.
- "Grafik Hazır" sonrası hiçbir üretim/kuyruk etkisi oluşmadığının doğrulanması.
- Aşama 1 paketi bu ortamda birlikte çalıştırılır; sonuçlar rapor edilir.

## Kapsam dışı (sonraki aşamalar)

Depo kabulü, silindir ziyaret kaydı ve QR; sepet, rezervasyon ve takım; rota;
operatör ekranları; rework; prova; sevkiyat; muhasebe.
