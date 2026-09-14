# Yol haritası

## Aşama 1 — Kimlik, yetki, istasyon, audit
- [x] Şema, RPC'ler, RLS, davet + e-posta doğrulama akışı
- [x] Güvenli test paketi (izole ortam kilitleriyle)
- [ ] Testlerin ayrı test projesinde çalıştırılması (blokaj: TEST_SUPABASE_* ortamı yok)

## Aşama 2 — Müşteri, sipariş, grafik
- [x] Müşteri tablosu ve Admin müşteri yönetimi
- [x] Sipariş tablosu, tekillik, row_version, iptal
- [x] Grafik durumu, PDF revizyonları, özel depolama, imzalı indirme
- [x] Sunucu RPC'leri + audit aynı transaction
- [x] Ekranlar: müşteri yönetimi, sipariş listesi/kartı, grafik paneli
- [ ] Aşama 2 testleri: eski sürümde tek seferlik `ASAMA2_OK/YETKI_OK` alınmıştı; bu sonuç
      güncel sürümün doğrulaması DEĞİLDİR. Güncel testler yazıldı, izole ortam olmadığı
      için çalıştırılmadı.
- [x] Uçtan uca gerçek veri akışı (müşteri → sipariş → PDF → grafik durumu) doğrulandı
- [x] PRD ve plan depoda saklanır
## Aşama 2 düzeltmeleri

### Parça 1 — Yetki ve veri güvenilirliği
- [x] Sipariş sahipliği sunucuda; geniş erişim `orders.edit_all` iznine bağlı
- [x] Muhasebe genel sipariş okumasından çıkarıldı
- [x] Asistan/Müdür sipariş izinleri rol varsayılanı değil, kişisel ek yetki
- [x] Boş/geçersiz `row_version` reddi
- [x] İşlem anahtarı: kullanıcı + komut + içerik kapsamında tekilleştirme
- [x] Kaydedilmemiş form taslağının korunması ve çakışma uyarısı

### Parça 2 — PDF akışı
- [x] Sunucu tarafı yükleme oturumu, yalnızca o yüklemeye ait hedef
- [x] Gerçek dosya doğrulaması (varlık, aidiyet, boyut, PDF imzası)
- [x] Revizyon + güncel dosya + denetim tek işlemde; hatada önceki PDF korunur
- [x] `expected_revision` çakışması kullanıcıya bildirilir, dosya kaybolmaz
- [x] Erişim yalnızca denetim kaydı üreten sunucu işlemiyle; doğrudan depolama kapalı
- [x] Sahipsiz yükleme temizliği + tekrarlanabilir depolama kurulumu

### Parça 3 — Sipariş listesi
- [x] Yoğun tablo, sabit başlık, sabit kimlik sütunları, tam sütun seti
- [x] Sunucu tarafı arama, filtre, sıralama, sayfalama ve toplam sayı
- [x] Grafik durumu / firmaya göre açılır kapanır gruplar (sayfa bazlı sayı etiketli)
- [x] Liste durumu adreste saklanır; detaydan dönünce korunur
- [x] Yeni sipariş yan panelde; sipariş tarihi formda; revizyon geçmişinde yükleyen
- [x] Yükleniyor / hata / boş / filtreye uyan yok durumları ayrı

### Parça 4 — Kod incelemesi düzeltmeleri
- [x] PDF kesinleştirme/temizlik yarışı: atomik durum geçişleri, temizlik öncesi "ayırma"
- [x] Aynı oturumun tekrarı önceki revizyon sonucunu döndürür; hata yolunda dosya silinmez
- [x] `create_order` / `update_order` işlem anahtarı içerik özeti tamamlandı
- [x] Rol/izin kurulumu tekrarlanabilir dosyada (`supabase/setup/roles-asama2.sql`)
- [x] Migration sırası ve araç sorumlulukları belgelendi + `bun run db:apply-schema`
- [x] Gerçek PDF geçerliliği (başlık + nesne + `/Root` + `startxref` + `%%EOF`)
- [x] Liste geniş ekranı kullanır; firma gruplaması `customer_id` anahtarlı
- [x] Yeni testler yazıldı (`tests/asama2-akis.test.mjs`, güncellenmiş `asama2-dogrulama.sql`)
- [ ] Testler çalıştırılmadı — izole test ortamı yok

## Tamamlanma şartları (Aşama 2)
- [x] İzin verilen akışlar gerçek kalıcı veriyle çalışır
- [x] Migration / uygulama aynı şemayı temsil eder
- [x] Doğrulanmayan işler açıkça belirtilir
- [x] Ürün sahibine çalışan sonuç sunulur
- [ ] Blokaj: izole test ortamı (TEST_SUPABASE_*) yok; Aşama 1 ve Aşama 2 otomatik test
      paketleri ayrı ortamda çalıştırılamadı


## Aşama 3 — Depo kabulü, silindir kartı ve QR
- [x] Kabul kaydı tablosu, ölçüm geçmişi, CYL kimliği ve RLS (`drizzle/migrations/0005`, `0006`)
- [x] Sunucu RPC'leri: kabul, düzeltme (kendi/bağlanmamış kayıt), gerekçeli iptal, etiket basım kaydı
- [x] Depo ekranı: yoğun tablo, arama/filtre/sıralama/sayfalama, yan panelde yeni kabul
- [x] Türkçe ondalık virgülü; hesaplanan çap yalnızca bilgi, kaydedilmez
- [x] "Önceki kaydı kopyala" ortak bilgileri doldurur, ölçüleri boş bırakır
- [x] Silindir kartı: kabul bilgileri, ölçüm geçmişi, not, QR etiketi ve yazdırma
- [x] QR okutma (kamera) + kodla arama; okutma operasyon başlatmaz
- [x] Canlı doğrulama: kabul oluştur → tabloda bul → kartı aç → etiketi gör → aynı kodla yeniden aç
- [ ] Ertelendi: kapsamlı sağlamlaştırma ve Aşama 3 otomatik testleri (izole test ortamı yok)

## Aşama 4 — Sepet, rezervasyon ve takım
- [x] Sipariş kartında "Silindirleri Hazırla" (team.manage yetkisiyle)
- [x] Aynı müşteriye ait depo adayları; hedeften çevre/boy farkı açıkça gösterilir
- [x] Başka müşteri, başka siparişe ayrılmış, üretimde, sevk, hurda, iptal ve
      kullanılamaz/şartlı silindirler seçilemez; nedeni satırda yazar
- [x] Sepete ekleme sunucuda rezervasyon oluşturur; aynı silindir iki siparişe ayrılamaz
      (kısmi tekil indeks); çıkarınca rezervasyon bırakılır, geçmiş korunur
- [x] Sepet sunucuda saklanır; sayfa yenilense de korunur
- [x] Planlanan ek işler (çevre düşürme/yükseltme, ana kaplama, mil çakma, yüzük değişimi,
      tamir) — yapılmış operasyon olarak kaydedilmez
- [x] "Yeni İmalat Ekle" yalnızca planlanan ihtiyaç; CYL/QR veya depo stoğu oluşturmaz
- [x] Gereken / seçilen / planlanan / eksik sayaçları; eksik varken takım kurulamaz
- [x] Takım benzersiz kod alır, siparişe bağlanır, mevcut ve planlanan üyeleri ayrı gösterir
- [x] Takım kurmak üretimi başlatmaz; üretim öncesi üye ekleme/çıkarma mümkün
- [x] Canlı doğrulama: seç → ikinci siparişte seçilemiyor → çıkar → serbest → yeniden seç →
      yeni imalatla tamamla → takım kur → yenile → üyeler korunuyor
- [ ] Ertelendi: Aşama 4 otomatik testleri (izole test ortamı yok)

## Aşama 5 — Rota önizleme, üretime alma ve istasyon kuyrukları
- [x] Aşama 4 düzeltmesi: Tamir Bekliyor aday yalnızca "Tamir planıyla ekle" ile seçilebilir
      (sunucuda da zorunlu); hurda/iptal/başka müşteri/başka siparişe ayrılmış engelli kalır
- [x] Depo ve aday listesi aynı cylinder_receipts kayıtlarını kullanır; sepet sunucuda tutulduğu
      için yenileme taslağı silmez; uygunluk sepete eklemede sunucuda tekrar kontrol edilir
- [x] Takım ekranında "Rotaları Hazırla"; her üye için ayrı rota, kimlik/tür/yüzey/ölçü/ek işler
- [x] Şablon önerisi (değişmez reçete değil), adım ekleme/çıkarma, atlama + zorunlu gerekçe
- [x] Rota sürümlenir; yeni sürüm önceki bekleyen adımları superseded yapar
- [x] "Üretime Al" (production.release): müşteri, aktif üyelik, rezervasyon, kullanılabilirlik ve
      rota geçerliliği sunucuda kontrol; hazır olmayanlar nedeniyle raporlanır; kısmi alma mümkün
- [x] Yalnızca ilk gerekli adım kuyruğa girer; sonraki adımlar planlı kalır
- [x] İstasyon kuyrukları ekranı: firma, iş emri, kimlik, işlem, ek işler, öncelik, bekleme, kritik not
- [x] Canlı test kayıtlarıyla doğrulama: rota kaydet → mevcut üyeyi üretime al → D-Krom/Sökme
      kuyruğunda göründü → planlanan imalat üyesi Torna kuyruğuna alındı → toplam 13 adımın
      yalnızca 2'si kuyrukta
- [ ] Denenmedi: aynı üyenin sunucu tarafında tekrar üretime alınma reddi (arayüzde seçim kapalı;
      kural kodda var, çalıştırılmadı) ve otomatik testler (izole test ortamı hâlâ yok)

## Aşama 6A — Operatör tablet ekranı, Torna ve tekil D-Krom/Sökme
- [x] `operations` / `operation_notes` tabloları, `op_start`, `op_complete_torna`,
      `op_complete_sokme`, `op_add_note`, `op_ack_note` RPC'leri; istasyon yetkisi, doğru üye,
      serbest bırakılmış rota, sırası gelen adım, makine meşguliyeti ve çift başlatma kontrolü
- [x] Operatör ekranı: Aktif İşlerim, QR Oku / Kod Gir, Yetkili İstasyon Kuyruğu,
      Blokeli / Karar Bekleyen İşler, Bugün Yaptıklarım; genel Duraklat yok
- [x] QR okutmak süreyi başlatmaz; Başlat anında sunucu zamanı, operatör ve makine yazılır
- [x] Canlı test: CYL-2026-00004 D-Krom/Sökme başlatıldı ve tamamlandı → yalnızca sonraki adım
      (Bakır Kaplama) kuyruğa girdi
- [x] Canlı test: planlanan imalat üyesi Torna'da tamamlandı → tek gerçek kayıt CYL-2026-00010
      oluştu, üyeye bağlandı, ölçüm kaydı yok işaretlendi, aşağı akış otomatik başlamadı
      (ayrı "Üretime Al" kararı bekliyor)
- [x] Arayüz düzeltmesi: tamamlanan rota adımı "Tamamlandı" gösterir; ölçümü olmayan yeni imalat
      kaydı 0 yerine "Ölçüm kaydı yok" / sipariş nominali gösterir (rota, depo, silindir kartı)
- [ ] Denenmedi: Bakır/Taşlama/CFM/Gravür/Krom formları (Aşama 6B) — bu istasyonlarda tanımlı
      makine olmadığı için başlatma da denenemedi; not/uyarı/bloke akışı canlıda denenmedi;
      otomatik testler (izole test ortamı hâlâ yok)

## Aşama 7 — Kalite bildirimi, karar, rework ve silindir değiştirme
- [x] Parça 1: uyarı/bloke ayrımı, operatör önerisi, usta danışma notu, Kalite/Karar Bekleyenler
      ekranı, yönetici kararı (devam / rework / silindir değişimi / red-ek bilgi), makine işgali
- [x] Parça 2 (migration 0016): `rework_suggest` / `rework_approve` / `team_replace_member`
- [x] Canlı test: blokeli silindirde yeni operasyon başlatma reddedildi ("BLOKE")
- [x] Canlı test: rework onayı → tur 2 rotası, yalnızca Bakır kuyrukta, eski plan/adımlar
      superseded, önceki 3 operasyon ve süreleri korundu; ikinci onay `already_applied`
- [x] Canlı test: iç hata → "Ücretsiz"; red kararı blokeyi kaldırmadı (operasyon bloke kaldı,
      sorumluluk bilinmiyor, faturalandırma boş)
- [x] Canlı test: başka siparişe ayrılmış silindir reddedildi ("REZERVE"); yeni imalat ile üye
      değişimi → eski üye pasif (neden + yerine geçen üye), eski silindir Tamir Bekliyor/şartlı
      olarak depoda, rezervasyon bırakıldı, açık rota kalmadı, yeni üye ayrı Üretime Al bekliyor,
      prova sayacı 1/2
- [ ] Denenmedi: Gravür hatasında doğrudan Gravür'e dönüş reddi ve Sökme'den başlayan yeniden
      hazırlama döngüsü (canlıda Gravür kaynaklı bloke oluşturulmadı)
- [ ] Denenmedi (6B'den devam): aynı kademenin iki üyeye atanmasının reddi, tekrar gönderilen
      Tamamla isteği, önceki uyarı/notların sonraki istasyonda görünmesi
- [ ] Denenmedi: kademe serbest kalması (değiştirilen üyenin atanmış kademesi yoktu)
- [ ] İzole otomatik test ortamı hâlâ yok

## Aşama 8 — Takım bazlı Prova ve son kontrol
- [x] `proof_runs` / `proof_run_members`, takım sevk hazırlığı ve parmak izi (`0017`)
- [x] `proof_gate`: adet, fiziksel üyelik, tamamlanmış adım, hazırlık, bloke, kademe 1…N tekilliği;
      planlanan/çıkarılan üyeler hazır sayılmaz; uyarı bloke sayılmaz
- [x] `proof_start` (yetki, PROVA makinesi, meşguliyet, aktif üye QR'si) ve `proof_complete`
      (4 sonuç, idempotency, onay parmak izi, kalite olayı üretimi)
- [x] Prova operatör ekranı `/operator/prova`: takım listesi, kapı gerekçeleri, üye tablosu,
      PDF erişimi, makine seçimi, sonuç formu, tur geçmişi
- [x] Canlı deneme: eksik takım başlatılamadı (gerekçeler listelendi) → hazır test takımı
      Prova'ya alındı → Onaylandı ile Sevkiyata Hazır → üyelik değişince onay geçersiz oldu
      → Tur 2 "Silindir Düzeltilecek" ile üye Müdür kararına düştü, sevk hazırlığı kalktı
- [x] Prova ana akışa bağlandı: istasyon seçicide Prova → doğrudan takım ekranı; diğer
      istasyonlarda Prova düğmesi yok; `/operator/prova` aynı ekranı açar
- [x] CYL bazlı Prova kapatıldı: `operations_no_cyl_proof` tetikleyicisi (`0018`); mevcut PROVA
      kuyruk adımları `superseded`, açık PROVA operasyonu sonuç üretmeden kapatıldı (audit kaydı ile)
- [x] Canlı deneme: iki fiziksel üyeli TAKIM-2026-0003 kuyrukta tek satır; üye QR'si (CYL-2026-00012)
      aynı takımı açtı; tek Başlat → tek Tamamla → Onaylandı → Sevkiyata Hazır
- [ ] Denenmedi: Tekrar Prova / Takım Yeniden Yapılacak sonuçları, tekrar gönderilen Tamamla,
      Müdür tarafında Prova kaynaklı kararın uygulanması, `proof_release_hold`
- [ ] Not: deneme için `TEST-PROVA` makinesi eklendi; A4-TEST-1 test siparişi adedi 1'e çekildi ve
      üretilmemiş planlanan test üyesi kapsam dışı bırakıldı (gerçek iş kaydı değiştirilmedi)

## Aşama 9 — Sevkiyat ve Arşiv (prototip, canlı denendi)
- Sevkiyat ekranı (Sevkiyata Hazır / Sevk Edilenler), Sevk Et onayı, sunucu tarafı `shipment_gate` + `ship_team`
- Arşiv ekranı (firma/iş emri/iş adı/CYL/tarih araması, salt okunur geçmiş)
- Silindir kartında "Bu ziyaret sevk edilerek kapatıldı" uyarısı; sevk edilen sipariş aktif listeden çıkar

### Açık işler
- Prova: Tekrar Prova / Takım Yeniden Yapılacak sonuçları, tekrarlanan Tamamla, Müdür kararının uygulanması, takım blokesinin kaldırılması
- Kademe tekilliği, tekrar Tamamla, uyarı/not aktarımı testleri
- Aşama 10: muhasebe ekranı (accounting_packages, accounting.process)
