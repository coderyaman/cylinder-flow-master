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
- Firma adı benzersiz **değildir**; aynı adla ikinci kayıt engellenmez. Kullanıcıya
  yalnızca "benzer adlı müşteri var" uyarısı gösterilir, karar Admin'indir.
- Pasif müşteri yeni siparişte seçilemez; geçmiş siparişleri bozulmaz.
- Yalnızca `admin.configure` yetkisi olan kullanıcı ekler/düzenler; her değişiklik audit'e girer.

### 2. Rol bazlı sipariş/grafik yetkileri
- `orders.create`: Grafik ve **Admin varsayılan olarak**; Asistan/Müdür ek yetkiyle.
- `orders.edit_graphics`: grafik durumu ve PDF yönetimi — Grafik ve Admin varsayılan,
  Asistan/Müdür ek yetkiyle.
- Sipariş **okuma** ile PDF **indirme** ayrı yetkilerdir:
  - Sipariş okuma: Grafik, Depo, Asistan, Müdür, Patron, Admin genel durumu görür;
    Muhasebe ticari havuzu görür; Operatör yalnızca ilgili işi/istasyonu.
  - PDF indirme (`orders.read_graphic_file`): Grafik, Asistan, Müdür, Admin varsayılan.
    Gravür operatörü sonraki aşamada, yalnızca üzerinde çalıştığı işe bağlı olarak
    erişir. Depo, Patron ve Muhasebe siparişi okur ama dosyayı indiremez.
- Bütün kontroller sunucuda; arayüz gizleme tek koruma değildir. İndirme bağlantısı
  yetki kontrolünden geçen sunucu çağrısıyla üretilir, dosya yolu istemciye açık değildir.

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
- **Düzenleme çakışması:** Sipariş kartında `row_version` tutulur. Kaydetme isteği
  okunan sürümü gönderir; arada başkası değiştirmişse istek reddedilir ve kullanıcıya
  "kayıt siz açtıktan sonra değişti, yeni hâli budur" ekranı gösterilir. Sessiz üzerine
  yazma yoktur.
- **Tekrar gönderilen istekler:** Her yazma komutu istemciden gelen bir işlem anahtarı
  taşır. Aynı anahtarla gelen ikinci istek yeni kayıt/revizyon üretmez, ilk sonucun
  aynısını döndürür (çift tıklama, ağ tekrarı, mobil yeniden gönderim).
- **Üretim öncesi iptal:** Sipariş silinmez; `iptal` kapanış durumuna alınır. Gerekçe
  zorunludur, audit'e yazılır. Grafik yalnızca kendi açtığı ve henüz üretime girmemiş
  siparişi iptal edebilir; Asistan/Müdür/Admin de iptal edebilir. İptal edilen sipariş
  salt okunur olur (durum/PDF değişmez), listede ayrı gösterilir. Bu aşamada üretim
  kavramı olmadığı için iptal her zaman "üretim öncesi"dir; sonraki aşamada üretim
  başlamışsa ayrı kural devreye girecek şekilde tek sunucu kontrolünde tutulur.

### 4. Grafik iş akışı ve PDF
- Grafik durumları: Dosya Bekleniyor → Renk Ayrımı Yapılıyor → Müşteri Onayı Bekleniyor
  → Revize Bekleniyor → Grafik Hazır. Geçişler serbest yönlüdür (revizeye dönüş olağan),
  her geçiş audit'e yazılır.
- Silindir/Klişe durumu: Durum Belirsiz, Depoda Mevcut, Müşteriden Silindir Bekleniyor,
  Yeni İmalat Gerekli, Kısmen Mevcut / Kısmen İmalat. Bu alan yalnızca beyandır;
  fiili adetler sonraki aşamada depo verisinden gelir.
- **PDF yükleme akışı (net sıra):**
  1. Kullanıcı dosyayı seçer; arayüz tür (yalnızca PDF), boyut (üst sınır 50 MB) ve
     boş dosya kontrolünü yapar.
  2. Sunucu yetkiyi doğrular ve siparişe özel, tahmin edilemez bir yükleme yolu üretir.
  3. Dosya özel (public olmayan) depolama alanına, `siparis_id/revizyon/dosya` düzeninde
     yüklenir. Depolama kuralları doğrudan istemci erişimine kapalıdır.
  4. Yükleme başarılıysa sunucu komutu çağrılır: veritabanı kaydı, revizyon numarası ve
     `is_current` işareti tek transaction içinde yazılır, audit kaydı aynı transaction'da
     oluşur.
  5. Veritabanı kaydı oluşmazsa yüklenen dosya sahipsiz kalır; bu dosyalar "kaydı
     olmayan yükleme" olarak işaretlenir ve periyodik temizlikte silinir. Kayıtlı hiçbir
     revizyon silinmez.
- **Eşzamanlı revizyon:** Revizyon numarası veritabanında, sipariş satırı kilitlenerek
  belirlenir. İki kullanıcı aynı anda yüklerse iki ayrı revizyon oluşur (kayıp yükleme
  yok), `is_current` yalnızca en yüksek revizyonda kalır; kısmi benzersiz kısıt ikinci
  bir güncel dosyayı imkânsız kılar. İkinci yükleyene "sizden sonra yeni revizyon geldi"
  bilgisi gösterilir.
- Revizyon geçmişi görünür: revizyon no, kim, ne zaman, dosya adı, boyut; her revizyon
  ayrı indirilebilir (yetkisi olana).
- İndirme: sunucu yetkiyi kontrol eder ve kısa ömürlü (ör. 5 dakika) imzalı bağlantı
  üretir; her indirme audit'e yazılır.
- "Grafik Hazır" bir üretim tetikleyicisi değildir; ekranda da bu açıkça yazılır.


## Teknik bölüm

Tablolar (hepsinde `created_at/by`, `updated_at/by`, RLS, GRANT, `updated_at` trigger):

- `customers(name, is_active)` — ad üzerinde benzersizlik kısıtı **yok**; yalnızca
  arama/uyarı için normalize edilmiş ad sütunu ve indeks.
- `orders(customer_id, work_order_no, normalized_work_order_no, name, quantity,
  nominal_circumference_mm, target_length_mm, ordered_on, due_on, graphic_status,
  supply_status, priority, note, critical_note, closure_status, cancel_reason,
  row_version)`
  - `UNIQUE(customer_id, normalized_work_order_no)`
  - `CHECK(quantity > 0)`, `due_on NOT NULL`, ölçüler için pozitiflik kontrolü
  - Enum'lar: `graphic_status`, `supply_status`, `order_priority`, `order_closure_status`
- `graphic_assets(order_id, revision_no, storage_path, filename, byte_size,
  content_type, checksum, uploaded_by, uploaded_at, is_current)`
  - `UNIQUE(order_id, revision_no)`, `UNIQUE(order_id) WHERE is_current`
  - Silme yok; yalnızca yeni revizyon.
- `command_log(idempotency_key, actor_id, command, result_ref, created_at)` —
  `UNIQUE(idempotency_key)`; tekrar gönderilen istekleri tekilleştirir.
- Depolama: özel `grafik-pdf` alanı; doğrudan istemci okuma/yazma politikası yok,
  erişim yalnızca sunucu tarafından üretilen imzalı bağlantıyla.

Sunucu kontrolleri (Aşama 1 deseni — istemcinin doğrudan INSERT/UPDATE yetkisi yok,
her yazma `SECURITY DEFINER` RPC üzerinden ve audit ile aynı transaction'da):

- `admin_create_customer`, `admin_update_customer`, `admin_set_customer_active`
- `create_order`, `update_order`, `cancel_order`, `set_graphic_status`
- `graphic_upload_target` (yetki + yol üretimi), `attach_graphic_revision`,
  `graphic_download_url`
- Her RPC: aktif hesap + izin + (varsa) müşteri aktifliği + `row_version` kontrolü,
  ardından `write_audit` ile eski/yeni değer kaydı. Audit yazılamazsa değişiklik
  geri alınır.
- Yazma komutları `_idempotency_key` alır; aynı anahtar ikinci kez gelirse yeni kayıt
  oluşmaz, ilk sonuç döner.
- `attach_graphic_revision` sipariş satırını kilitler, revizyon numarasını atar, eski
  `is_current` işaretini kaldırır ve yenisini koyar — hepsi tek transaction'da.
- Anlaşılır hata kodları: `IS_EMRI_TEKRAR`, `SURUM_ESKI` (çakışma), `MUSTERI_PASIF`,
  `IPTAL_EDILMIS`, `DOSYA_GECERSIZ`, `YETKISIZ`.


Durum geçişleri:

```text
graphic_status: dosya_bekleniyor ↔ renk_ayrimi ↔ musteri_onayi ↔ revize ↔ grafik_hazir
supply_status : belirsiz | depoda_mevcut | silindir_bekleniyor | yeni_imalat | kismi
closure_status: acik → iptal (üretim öncesi, gerekçeli); iptal salt okunurdur
(üretim durumu bu aşamada YOK — sonraki aşamalarda operasyonlardan türetilir)
```

## Hata ve istisna senaryoları

- Aynı müşteride tekrarlanan iş emri no → red (eşzamanlı istekte de tek kayıt).
- Termin boş / adet ≤ 0 / negatif ölçü → red, alan bazlı hata.
- Pasif veya var olmayan müşteri ile sipariş → red.
- Yetkisiz kullanıcının API'den sipariş açma / PDF değiştirme / PDF indirme denemesi → red.
- İki kullanıcı aynı siparişi eş zamanlı düzenler → ikincisi `SURUM_ESKI` ile reddedilir,
  güncel hâl gösterilir; kimsenin değişikliği sessizce kaybolmaz.
- Aynı komut iki kez gönderilir (çift tıklama/ağ tekrarı) → tek kayıt, tek revizyon,
  tek audit satırı.
- Aynı siparişe eşzamanlı iki PDF yüklemesi → iki revizyon saklanır, tek `is_current`
  kalır; ikinci yükleyene yeni revizyon geldiği bildirilir.
- Yükleme yarıda kalır veya kayıt yazılamaz → sipariş dosyasız kalır, sahipsiz dosya
  temizlenir; hatalı "güncel PDF" görünmez.
- Bozuk/boş dosya, PDF olmayan tür veya boyut aşımı → red; kayıt oluşmaz.
- İptal edilmiş siparişte düzenleme/PDF yükleme → `IPTAL_EDILMIS` ile red.
- Müşteri pasifleştirildiğinde mevcut siparişler okunur ve düzenlenebilir kalır.

## Test planı (ayrı test ortamında)

- AC-01, AC-02 ve eşzamanlı çift sipariş denemesi.
- Rol matrisi: her rol için sipariş açma/okuma/PDF değiştirme/PDF indirme API denemeleri;
  siparişi okuyabilen ama dosyayı indiremeyen rollerin ayrıca doğrulanması.
- Sürüm çakışması: eski `row_version` ile güncelleme reddi.
- Tekrar gönderim: aynı işlem anahtarıyla iki istek → tek sonuç.
- Audit: her sipariş, iptal, grafik ve indirme olayı için eski/yeni değerli tek kayıt;
  denetim yazılamazsa değişikliğin geri alınması.
- PDF: yükleme, revizyon artışı, eşzamanlı iki yükleme, tek güncel dosya, eski
  revizyonun korunması, imzalı bağlantının süresi dolunca çalışmaması.
- Üretim öncesi iptal: gerekçesiz iptal reddi, iptal sonrası yazma denemelerinin reddi.
- "Grafik Hazır" sonrası hiçbir üretim/kuyruk etkisi oluşmadığının doğrulanması.
- Aşama 1 paketi bu ortamda birlikte çalıştırılır; sonuçlar rapor edilir.


## Kapsam dışı (sonraki aşamalar)

Depo kabulü, silindir ziyaret kaydı ve QR; sepet, rezervasyon ve takım; rota;
operatör ekranları; rework; prova; sevkiyat; muhasebe.
