import type { Database } from "@/integrations/supabase/types";

export type PlannedOp = Database["public"]["Enums"]["planned_op"];
export type CartItemKind = Database["public"]["Enums"]["cart_item_kind"];
export type CylLifecycle = Database["public"]["Enums"]["cyl_lifecycle"];

/** Planlanan ek işler. Bunlar yapılmış operasyon kaydı DEĞİLDİR. */
export const PLANNED_OP_LABELS: Record<PlannedOp, string> = {
  cevre_dusurme: "Çevre Düşürme",
  cevre_yukseltme: "Çevre Yükseltme",
  ana_kaplama: "Ana Kaplama",
  mil_cakma: "Mil Çakma",
  yuzuk_degisimi: "Yüzük Değişimi",
  tamir: "Tamir",
};

export const PLANNED_OPS = Object.keys(PLANNED_OP_LABELS) as PlannedOp[];

export const LIFECYCLE_LABELS: Record<CylLifecycle, string> = {
  depoda: "Depoda",
  kontrol_bekliyor: "Kontrol bekliyor",
  tamir_bekliyor: "Tamir bekliyor",
  uretimde: "Üretimde",
  sevk_edildi: "Sevk edildi",
  hurda: "Hurda",
};

export function teamErrorText(message: string): string {
  if (message.includes("REZERVE")) return "Bu silindir başka bir siparişe ayrılmış.";
  if (message.includes("TAKIM_VAR")) return "Bu siparişin takımı zaten oluşturulmuş.";
  if (message.includes("EKSIK_ADET"))
    return "Sepet sipariş adedini karşılamıyor. Eksik adedi tamamlayın.";
  if (message.includes("IPTAL_EDILMIS")) return "İptal edilmiş sipariş için işlem yapılamaz.";
  if (message.includes("YETKISIZ")) return "Bu işlem için yetkiniz yok.";
  if (message.includes("GECERSIZ")) return message.replace(/^.*GECERSIZ:\s*/, "");
  return message;
}

/** Hedef ölçüden fark; işareti korunur, teknik uygunluk kararı KULLANICIYA aittir. */
export function diff(actual: number, target: number): number {
  return actual - target;
}

export function formatDiff(v: number): string {
  const s = v.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
  return v > 0 ? `+${s}` : s;
}
