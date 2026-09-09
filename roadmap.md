# Yol haritası

## Aşama 1 — Kimlik, yetki, istasyon, audit
- [x] Şema, RPC'ler, RLS, davet + e-posta doğrulama akışı
- [x] Güvenli test paketi (izole ortam kilitleriyle)
- [ ] Testlerin ayrı test projesinde çalıştırılması (blokaj: TEST_SUPABASE_* ortamı yok)

## Aşama 2 — Müşteri, sipariş, grafik
- [ ] Müşteri tablosu ve Admin müşteri yönetimi
- [ ] Sipariş tablosu, tekillik, row_version, iptal
- [ ] Grafik durumu, PDF revizyonları, özel depolama, imzalı indirme
- [ ] Sunucu RPC'leri + audit aynı transaction
- [ ] Ekranlar: müşteri yönetimi, sipariş listesi/kartı, grafik paneli
- [ ] Aşama 2 testleri (izole ortam gerektirenler ayrıca belirtilecek)
- [x] PRD ve plan depoda saklanır

## Tamamlanma şartları (Aşama 2)
- İzin verilen akışlar gerçek kalıcı veriyle çalışır
- Migration / uygulama / test ortamı aynı şemayı temsil eder
- Testler çalıştırılır ve sonuçları raporlanır
- Doğrulanmayan işler açıkça belirtilir
- Ürün sahibine çalışan sonuç sunulur
