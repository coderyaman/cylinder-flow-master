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
- [x] Aşama 2 testleri gerçek şema üzerinde çalıştırıldı (ASAMA2_OK, YETKI_OK)
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

## Tamamlanma şartları (Aşama 2)
- [x] İzin verilen akışlar gerçek kalıcı veriyle çalışır
- [x] Migration / uygulama aynı şemayı temsil eder
- [x] Doğrulanmayan işler açıkça belirtilir
- [x] Ürün sahibine çalışan sonuç sunulur
- [ ] Blokaj: izole test ortamı (TEST_SUPABASE_*) yok; Aşama 1 ve Aşama 2 otomatik test
      paketleri ayrı ortamda çalıştırılamadı

