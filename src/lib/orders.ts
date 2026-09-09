import type { Database } from "@/integrations/supabase/types";

export type GraphicStatus = Database["public"]["Enums"]["graphic_status"];
export type SupplyStatus = Database["public"]["Enums"]["supply_status"];
export type OrderPriority = Database["public"]["Enums"]["order_priority"];
export type ClosureStatus = Database["public"]["Enums"]["order_closure_status"];

export const GRAPHIC_STATUS_LABELS: Record<GraphicStatus, string> = {
  dosya_bekleniyor: "Dosya Bekleniyor",
  renk_ayrimi: "Renk Ayrımı Yapılıyor",
  musteri_onayi: "Müşteri Onayı Bekleniyor",
  revize: "Revize Bekleniyor",
  grafik_hazir: "Grafik Hazır",
};

export const SUPPLY_STATUS_LABELS: Record<SupplyStatus, string> = {
  belirsiz: "Durum Belirsiz",
  depoda_mevcut: "Depoda Mevcut",
  silindir_bekleniyor: "Müşteriden Silindir Bekleniyor",
  yeni_imalat: "Yeni İmalat Gerekli",
  kismi: "Kısmen Mevcut / Kısmen İmalat",
};

export const PRIORITY_LABELS: Record<OrderPriority, string> = {
  normal: "Normal",
  yuksek: "Yüksek",
  acil: "Acil",
};

export const GRAPHIC_STATUSES = Object.keys(GRAPHIC_STATUS_LABELS) as GraphicStatus[];
export const SUPPLY_STATUSES = Object.keys(SUPPLY_STATUS_LABELS) as SupplyStatus[];
export const PRIORITIES = Object.keys(PRIORITY_LABELS) as OrderPriority[];

/** Sunucudan gelen hata kodlarını kullanıcı diline çevirir. */
export function orderErrorText(message: string): string {
  if (message.includes("IS_EMRI_TEKRAR"))
    return "Bu müşteride aynı iş emri numarası zaten var.";
  if (message.includes("SURUM_ESKI"))
    return "Kayıt siz açtıktan sonra değişti. Sayfayı yenileyip güncel hâli görün.";
  if (message.includes("MUSTERI_PASIF")) return "Pasif müşteriye sipariş açılamaz.";
  if (message.includes("IPTAL_EDILMIS")) return "İptal edilmiş sipariş değiştirilemez.";
  if (message.includes("DOSYA_GECERSIZ")) return "Dosya geçersiz. Yalnızca 50 MB'a kadar PDF yüklenebilir.";
  if (message.includes("ISLEM_DEVAM")) return "Aynı istek halen işleniyor, lütfen bekleyin.";
  if (message.includes("PASIF_HESAP")) return "Hesabınız pasif durumda.";
  if (message.includes("YETKISIZ")) return "Bu işlem için yetkiniz yok.";
  if (message.includes("GECERSIZ")) return message.replace(/^.*GECERSIZ:\s*/, "");
  return message;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function isLate(due: string, closure: ClosureStatus): boolean {
  if (closure === "iptal") return false;
  return new Date(due) < new Date(new Date().toDateString());
}
