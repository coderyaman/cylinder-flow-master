# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Ürün gereksinim belgesi

Bağlayıcı gereksinim belgesi depoda saklanır:
[docs/Rotagravur_MES_PRD_Vibe_Coding_v2.0.md](docs/Rotagravur_MES_PRD_Vibe_Coding_v2.0.md)

## Davet ve e-posta doğrulama akışı

- Kayıt yalnızca yönetici daveti ile açıktır (`app_settings.signup_open = false`).
- Kayıt anında **rol verilmez**. Davetteki rol, kullanıcı e-posta adresini doğrulama
  bağlantısıyla onayladıktan sonra `claim_invite()` ile verilir ve aynı işlemde denetim
  kaydı oluşur.
- Doğrulanmamış hesap `claim_invite()` çağırdığında `EPOSTA_DOGRULANMADI` hatası alır;
  davet adresini bilen ancak posta kutusuna erişemeyen kişi hesabı sahiplenemez.
- Auth ayarında otomatik e-posta onayı (`mailer_autoconfirm`) kapatılmıştır.

## Güvenlik testleri

Aşama 1 yetki, denetim ve eşzamanlılık senaryoları doğrudan API/veritabanı seviyesinde
test edilir. **Testler yalnızca ayrı bir test projesinde çalışır**; gerçek proje
hedeflendiğinde hiçbir değişiklik yapmadan durur (çıkış kodu 78).

```sh
TEST_SUPABASE_URL=... \
TEST_SUPABASE_PUBLISHABLE_KEY=... \
TEST_SUPABASE_SERVICE_ROLE_KEY=... \
TEST_SUPABASE_DB_URL=postgresql://... \
bun run test:security
```

Güvenlik kilitleri (hepsi ilk değişiklikten **önce** çalışır):

- Dört ortam değişkeninden biri eksikse test durur.
- `.env` içindeki gerçek Supabase adresi veya proje kimliği hedeflenirse test durur.
- `TEST_SUPABASE_DB_URL` ile `TEST_SUPABASE_URL` aynı test projesini göstermiyorsa,
  ya da API ile veritabanı farklı sayıda kullanıcı görüyorsa test durur.
- Hedef veritabanında `@rotagravur.test` dışında bir hesap varsa test durur.
- Test hesapları gerçek kullanıcı akışıyla (kayıt → doğrulama bağlantısı → oturum)
  oluşturulur; gerçek hesaplar hiçbir zaman pasifleştirilmez veya değiştirilmez.
- Çalıştırma başında ve sonunda yalnızca `@rotagravur.test` hesapları ve davetleri
  silinir; böylece testler arka arkaya iki kez sorunsuz çalışır ve önceki
  çalıştırmadan kalan aktif test Admin'i son Admin senaryosunu bozmaz.
- Denetim geri alma testi (`tests/audit-rollback.sql`) gerçek `admin_set_user_role`
  fonksiyonunu kullanır; denetim yazımı tek transaction içinde kontrollü olarak
  başarısız kılınır, beklenen hata türü doğrulanır ve transaction geri alınır.
  Parametreler `set_config()` ile aktarılır, başarı işareti stdout'a yazılır ve
  denetim kontrolü yalnızca o çalıştırmaya özel işareti arar. Eksik fonksiyon,
  yetki veya bağlantı hatası testi geçirmez.


## Güvenlik uyarıları (Supabase linter)

Tek uyarı türü kalmıştır: *Signed-In Users Can Execute SECURITY DEFINER Function*.
Gerekçeler:

- `admin_*` fonksiyonları: yönetim işlemleri kasıtlı olarak yalnızca bu fonksiyonlarla
  yapılır; her biri `assert_admin_caller()` ile aktif Admin ve `admin.configure` iznini
  doğrular ve denetim kaydını aynı transaction'da yazar.
- `has_role`, `has_permission`, `has_station_scope`, `is_admin`, `is_active_user`,
  `has_any_role`, `caller_is_admin`, `can_read_directory`: RLS politikalarının çalışması
  için gereklidir; başka kullanıcı kimliğiyle sorgulama Admin veya kişinin kendisiyle
  sınırlıdır.
- `claim_invite`: davet sahibinin kendi hesabıyla çağırması gerekir; e-posta doğrulaması
  sunucuda `auth.users` üzerinden kontrol edilir.
- `write_audit`, `assert_admin_caller`, `assert_admin_remains`, `handle_new_user`,
  `set_updated_at`: yalnızca sistemin kendi içinde kullanılır; giriş yapmış kullanıcıların
  doğrudan çağırma yetkisi kaldırılmıştır.

Yalnızca test amaçlı `audit_atomicity_probe` fonksiyonu üretim şemasından kaldırılmıştır.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
