export const APP_ROLES = [
  "grafik",
  "depo",
  "operator",
  "asistan",
  "mudur",
  "patron",
  "muhasebe",
  "admin",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  grafik: "Grafik",
  depo: "Depo",
  operator: "Operatör",
  asistan: "Üretim Asistanı",
  mudur: "Üretim Müdürü",
  patron: "Patron / Yönetici",
  muhasebe: "Muhasebe",
  admin: "Admin",
};

export const ROLE_DESCRIPTIONS: Record<AppRole, string> = {
  grafik: "Sipariş açar, grafik durumlarını ve PDF'i yönetir.",
  depo: "Silindir kabulü, teknik kart ve ölçüm kaydı.",
  operator: "Yetkili istasyonlarda operasyon başlatır ve tamamlar.",
  asistan: "Sepet, takım, üretime alma, rework onayı ve sevkiyat.",
  mudur: "Asistan yetkileri ile birlikte prova geri dönüşü ve ticari override.",
  patron: "Rapor ve genel durum okuma.",
  muhasebe: "Gerçekleşen işçilikleri görür ve İşlendi kaydı yapar.",
  admin: "Kullanıcı, rol, istasyon ve form tanımları. Denetim kaydını silemez.",
};
