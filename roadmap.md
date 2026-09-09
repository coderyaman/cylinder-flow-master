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
- [ ] Açık: PDF yükleme/indirme istemciden depoya doğrudan yapılıyor; sunucu tarafı
      yükleme hedefi + indirme kaydı (audit) sonraki düzeltmede eklenecek

## Tamamlanma şartları (Aşama 2)
- [x] İzin verilen akışlar gerçek kalıcı veriyle çalışır
- [x] Migration / uygulama / test ortamı aynı şemayı temsil eder
- [x] Testler çalıştırılır ve sonuçları raporlanır
- [x] Doğrulanmayan işler açıkça belirtilir
- [x] Ürün sahibine çalışan sonuç sunulur

