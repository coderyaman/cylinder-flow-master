# Cylinder Flow

Hazır. Lovable’a önce aşağıdaki Markdown dosyasını yükle, ardından promptu tek mesaj olarak gönder:

[Rotagravür MES — Vibe Coding PRD v2.0](/Users/raskolmucov/Documents/Codex/2026-09-09/referenced-chatgpt-conversation-this-is-an/outputs/Rotagravur_MES_PRD_Vibe_Coding_v2.0.md)

Eklediğim Rotagravur_MES_PRD_Vibe_Coding_v2.0.md dosyası, geliştireceğimiz ürünün ana ve bağlayıcı gereksinim belgesidir. Belgenin tamamını dikkatle oku.

Bu proje, rotagravür silindir işleme fabrikaları için geliştirilecek bir MES / Üretim Yönetim Sistemidir.

Çözdüğümüz problem

Fabrikada siparişler takip edilmesine rağmen siparişe bağlı fiziksel silindirler üretim boyunca tek tek izlenemiyor.

Aynı siparişe ait silindirlerden biri Bakır’da, biri Taşlama’da, biri Gravür’de, biri Krom’da, biri bekliyor veya bloke durumda olabilir. Üretim sorumluları mevcut durumu öğrenmek için sahada silindir aramak ve operatörlere sormak zorunda kalıyor.

Geliştireceğimiz sistemde temel takip nesnesi fiziksel silindirdir.

Her silindir fabrikaya kabul edildiği andan sevk edildiği ana kadar benzersiz bir ziyaret kimliği ve QR koduyla izlenecek. Operatörler QR üzerinden doğru işi açacak, operasyonu uygun makinede başlatacak, yapılan işlemleri ve gerekli ölçüleri kaydedecek ve tamamlayacak.

Sistem bu kayıtlardan:

Silindirin mevcut konumunu,

İstasyon kuyruklarını,

İşlem ve bekleme sürelerini,

Siparişin gerçek üretim dağılımını,

Darboğazları,

Kalite sorunlarını ve reworkleri,

Makine duruşlarını,

Operatör ve vardiya üretimlerini,

Gerçekleşen ücretli ve ücretsiz işçilikleri,

Sevkiyat ve muhasebe durumlarını

hesaplayacak.

Ana ürün zinciri şöyledir:

Müşteri → Sipariş ve Grafik → Depo Kabulü → Silindir Hazırlama Sepeti → Takım → Silindir Bazlı Rota → İstasyon Kuyrukları → Operatör İşlemleri → Kalite/Rework → Takım Provası → Sevkiyat → Muhasebe → Arşiv ve Raporlama

Kullanacağımız altyapı

Proje şu bağlantılarla geliştirilecek:

Lovable: Uygulama geliştirme ve kullanıcı arayüzü.

GitHub: Kaynak kodun ve değişiklik geçmişinin ana deposu.

Supabase Database: Kalıcı ve ilişkisel ürün verileri.

Supabase Auth: Kullanıcı girişi ve kimlik doğrulama.

Supabase Storage: Siparişlere bağlı grafik PDF dosyaları.

Supabase Realtime: Kanban, kuyruk ve üretim durumlarının gerekli ekranlarda güncel tutulması.

Bu teknoloji tercihleri kesinleşmiştir. Ancak PRD’deki ürün kuralları teknoloji tercihlerinden daha üstündür.

PRD’yi nasıl okuyacaksın?

Belgedeki işaretlerin anlamları:

[K]: Kesin ürün kuralıdır. Değiştirme veya atlama.

[N]: Konuşmalarımızdaki farklı ifadelerden çıkarılmış nihai karardır.

[Ö]: Teknik uygulama önerisidir. Aynı güvenilir sonucu sağlayan daha uygun bir teknik yöntem önerebilirsin.

[A]: Henüz kesinleşmemiş ayrıntıdır. Bilinmeyen bilgiyi uydurma.

Ürün sahibinin bu belgeden sonra verdiği açık kararlar, belgedeki eski kararlardan önceliklidir.

PRD’yi yalnızca ekran veya özellik listesi olarak okuma. Her özellik için şunları birlikte değerlendir:

Hangi rol kullanabilir?

Başlamadan önce hangi koşullar sağlanmalıdır?

Kullanıcı hangi işlemi yapar?

Supabase’de hangi kalıcı kayıtlar oluşur veya değişir?

Hangi durum geçişi meydana gelir?

İşlem hangi koşullarda engellenir?

Audit kaydına ne yazılır?

İşlem iki kez gönderilirse çift kayıt nasıl engellenir?

İlgili PRD kabul kriteri nasıl doğrulanır?

Temel kavramları karıştırma

Aşağıdaki kavramlar ayrı veri varlıkları ve ayrı iş kurallarıdır:

Sipariş, fiziksel silindir değildir.

Takım, silindir değildir.

Takım üyeliği, fiziksel silindirin kendisi değildir.

İstasyon, yapılan işlem değildir.

Planlanan rota adımı, gerçekleşmiş operasyon değildir.

Aynı operasyonda birden fazla yapılan iş bulunabilir.

Rework, eski operasyonun düzenlenmesi değildir; yeni üretim turudur.

Prova, tekil silindir değil takım seviyesinde gerçekleşir.

Prova onayı, sevkiyat değildir.

Sevkiyat, muhasebede işlendi anlamına gelmez.

Muhasebede işlendi, sistem içinde fatura kesildiği anlamına gelmez.

Geliştirme yaklaşımı

Bütün platformu tek seferde geliştirmeye çalışma.

Projeyi küçük, birbirine bağlı ve doğrulanabilir aşamalar halinde geliştir. Her aşama tamamlandığında dur, sonucu bildir ve sonraki aşamaya geçmeden benden onay bekle.

Önerilen geliştirme sırası:

Temel veri modeli, kullanıcılar, roller, istasyon yetkileri ve audit altyapısı.

Müşteri, sipariş ve Grafik Birimi akışı.

Depo kabulü, silindir kimliği, ölçüm geçmişi ve QR yaşam döngüsü.

Silindir hazırlama sepeti, rezervasyon, planlanan yeni imalat ve takım oluşturma.

Rota motoru, kısmi üretime alma ve istasyon kuyrukları.

Operatör tablet akışı ve istasyon bazlı dinamik formlar.

Toplu Sökme, uyarı, bloke, kalite, rework ve silindir değiştirme.

Takım seviyesinde Prova ve son kontrol.

Tam takım sevkiyatı, silindir ziyaretinin kapanması ve arşiv.

Gerçekleşen işçilikler, faturalandırma kuralları ve Muhasebe ekranı.

Makine, vardiya, duruş, Kanban, dashboard, rapor, bildirim ve arama.

PRD kabul kriterleri, eşzamanlılık kontrolleri ve uçtan uca senaryolar.

Her aşamada uygulanacak yöntem

Her geliştirme aşamasından önce:

Kullanacağın PRD bölümlerini belirt.

O aşamanın kullanıcı akışlarını açıkla.

Etkilenen veri tablolarını ve ilişkilerini göster.

Uygulanacak kesin iş kurallarını listele.

Roller ve yetkileri belirt.

Hata ve istisna senaryolarını çıkar.

Karşılanacak kabul kriterlerini listele.

Ardından yalnızca onaylanan aşamayı geliştir.

Aşama tamamlandığında:

Çalışan özellikleri,

Oluşturulan veya değiştirilen Supabase tablolarını,

Uygulanan RLS kurallarını,

Eklenen sayfa ve kullanıcı akışlarını,

Doğrulanan kabul kriterlerini,

Henüz yapılmayan işleri,

Bir sonraki önerilen aşamayı

kısa ve açık biçimde bildir.

Sonraki aşamaya kendiliğinden geçme.

GitHub çalışma kuralları

Bağlı GitHub deposunu tek kaynak olarak kullan.

Kullanıcının mevcut değişikliklerini veya proje yapısını izinsiz silme.

Her onaylanmış aşamayı anlaşılır ve sınırlı değişikliklerle uygula.

Veritabanı migration dosyalarını kaynak koduyla birlikte GitHub’da sakla.

Supabase üzerinde yapılan şema değişikliği ile GitHub’daki migration dosyalarının farklılaşmasına izin verme.

Geçmişi yeniden yazma, zorla gönderme veya geri döndürülmesi zor Git işlemleri yapma.

Gizli anahtarları, servis anahtarlarını ve bağlantı bilgilerini repoya yazma.

Her aşama sonunda kaynak kod ve veritabanı şemasının aynı sürümü temsil ettiğini doğrula.

Supabase kuralları

Kalıcı ürün verileri tarayıcı belleğinde tutulmamalıdır.

Supabase Auth yalnızca kullanıcının kimliğini doğrular; uygulama yetkileri ayrıca veri tabanında kontrol edilmelidir.

Grafik, Depo, Operatör, Üretim Asistanı, Üretim Müdürü, Yönetici/Patron, Muhasebe ve Admin rolleri uygulanmalıdır.

Yetkilendirmeyi yalnızca menü veya düğme gizlemeye bırakma.

Dışarı açılan bütün tablolarda RLS etkin olmalıdır.

RLS politikalarını gerçek rol ve istasyon yetkilerine göre oluştur.

Yalnızca authenticated kontrolü yapmak yeterli yetkilendirme değildir.

Kullanıcı tarafından değiştirilebilen profil metadata alanlarını yetki kaynağı olarak kullanma.

Service role veya secret anahtarı tarayıcı koduna koyma.

UPDATE politikalarında okuma ve yeni değer kontrollerini birlikte uygula.

Yetkili kullanıcı üretim kaydını düzeltebilse bile audit kaydını silememelidir.

Güçlü veritabanı fonksiyonlarını yalnızca izin hatasını aşmak amacıyla kullanma.

Sipariş PDF dosyalarını özel bir Storage alanında tut ve erişimi role göre sınırla.

PDF yükleme, görüntüleme ve değiştirme işlemleri audit geçmişiyle ilişkilendirilsin.

Şema değişikliklerini migration olarak oluştur.

Her şema değişikliğinden sonra ilişkileri, kısıtları, RLS politikalarını ve temel sorguları doğrula.

Supabase’in güncel dokümantasyonunu kontrol ederek çalış; eski veya tahmine dayalı API kullanımına güvenme.

Değişmez ürün kurallarından bazıları

Bir müşterinin silindiri başka müşterinin işinde kullanılamaz.

Aynı silindir aynı anda iki sipariş için rezerve edilemez.

Siparişin üretime hazır olması, üretimin otomatik başlaması değildir.

Eksik takımın hazır üyeleri Asistan/Müdür kararıyla üretime alınabilir.

Eksik üye sonradan hazır olduğunda kendiliğinden üretime katılmaz.

Operatör QR okutunca süre başlamaz; ayrıca Başlat işlemi gerekir.

Operasyon tamamlandığında gerekli form verileri kaydedilir ve sonraki kuyruk oluşur.

Tamamlanan operasyon operatör tarafından değiştirilemez.

Aynı takımda aynı kademe iki aktif silindire atanamaz.

Kademe ve gerçek ölçüler Taşlama sırasında belirlenir.

Sistem otomatik kademe ölçüsü veya teknik tolerans kararı üretmez.

Grafik PDF’i olmadan hazırlık işlemleri yapılabilir; Gravür başlatılamaz.

Gravür hatası doğrudan tekrar Gravür’e gönderilemez.

Gravürün yeniden yapılması için Sökme → Bakır → Taşlama → CFM → Gravür hazırlığı gerekir.

Rework eski operasyonu değiştirmez; yeni operasyon turu oluşturur.

Uyarı üretimi durdurmaz, bloke üretimi durdurur.

Operatörün rework önerisi rota değişikliğini otomatik onaylamaz.

Üretim başladıktan sonra silindir değişimi özel işlemle yapılır.

Eski silindirin operasyonları ve takım üyeliği geçmişten silinmez.

Yeni silindire eski kademe ve ölçüler otomatik aktarılmaz.

Prova takım seviyesindedir.

Takımın bütün zorunlu üyeleri hazır olmadan Prova ve sevkiyat yapılamaz.

Kısmi sevkiyat yoktur.

Prova onayı sevkiyatı otomatik gerçekleştirmez.

Sevk edilen silindirin ziyaret kimliği kapanır.

Aynı fiziksel metal ileride dönerse yeni silindir ziyaret kaydı ve QR oluşturulur.

Gerçekleşen işlem, faturalandırılabilirlik ve muhasebede işlenme ayrı kavramlardır.

İç üretim hatasından kaynaklanan rework müşteriye faturalanmaz.

Müşteri revizyonundan kaynaklanan rework faturalandırılabilir.

Hiçbir gerçekleşmiş üretim veya audit kaydı sessizce silinmez.

Kaçınılması gereken yanlış geliştirme davranışları

İlk mesajdan sonra bütün sistemi ve bütün tabloları aynı anda oluşturmaya çalışma.

Büyük bir landing page veya ürün tanıtım sitesi hazırlama.

Sahte verilerle güzel görünen ancak gerçek iş akışı olmayan dashboard’u tamamlanmış ürün gibi sunma.

Bütün modülleri tek sayfa bileşenine doldurma.

İş kurallarını yalnızca frontend kontrollerine bırakma.

Tarayıcı belleğini ana veritabanı olarak kullanma.

Supabase tablolarını RLS olmadan dışarı açma.

Tüm giriş yapmış kullanıcılara bütün üretim verilerini değiştirme yetkisi verme.

İşlem geçmişini güncel durum alanlarının üzerine yazarak kaybetme.

Sipariş iptal edildiğinde yapılmış işçilikleri silme.

Kanban kartını başka sütuna taşıyarak üretim yapılmış sayma.

Örnek ölçü farklarını evrensel üretim formülüne dönüştürme.

PRD’nin V1 kapsam dışı özelliklerini kendiliğinden ekleme.

Bilinmeyen cihaz, tolerans, fiyat veya işletim bilgisini uydurma.

İlk cevabında yapman gerekenler

Bu ilk cevapta kod yazma, dosya oluşturma, Supabase tablosu veya migration hazırlama, GitHub’a commit gönderme ve arayüz üretme.

Yalnızca şunları sun:

Ürünün ne olduğunu kendi cümlelerinle anlat.

Çözdüğü operasyonel ve ticari problemleri özetle.

Ana kullanıcı rollerini ve sorumluluklarını açıkla.

Sipariş, takım, silindir, rota, operasyon, rework, Prova, sevkiyat ve muhasebe ilişkisini açıkla.

PRD’de kesinlikle korunması gereken kritik kuralları çıkar.

Lovable + GitHub + Supabase yapısı için önerdiğin genel mimariyi anlat.

Geliştirmeyi küçük aşamalara ayır ve her aşamanın somut çıktısını yaz.

İlk aşamada kullanılacak PRD bölümlerini ve kabul kriterlerini belirt.

Yalnızca ilk aşamayı gerçekten engelleyen açık bir karar varsa sor.

Benden onay bekle.

Ben geliştirme planını onayladıktan sonra yalnızca birinci aşamaya başlayacaksın.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/36b7509f-82fc-42a9-ab5e-cdba1549abaf).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
