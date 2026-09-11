import type { Database } from "@/integrations/supabase/types";

export type ShaftType = Database["public"]["Enums"]["cyl_shaft_type"];
export type SurfaceState = Database["public"]["Enums"]["cyl_surface_state"];
export type Usability = Database["public"]["Enums"]["cyl_usability"];
export type ReceiptStatus = Database["public"]["Enums"]["cyl_receipt_status"];

export const SHAFT_LABELS: Record<ShaftType, string> = {
  konik: "Konik mil",
  silindirik: "Silindirik mil",
  flansli: "Flanşlı mil",
  diger: "Diğer",
};

export const SURFACE_LABELS: Record<SurfaceState, string> = {
  temiz: "Temiz",
  bakirli: "Bakırlı",
  kromlu: "Kromlu",
  asinmis: "Aşınmış",
  hasarli: "Hasarlı",
};

export const USABILITY_LABELS: Record<Usability, string> = {
  kullanilabilir: "Kullanılabilir",
  sartli: "Şartlı kullanılabilir",
  kullanilamaz: "Kullanılamaz",
};

export const SHAFT_TYPES = Object.keys(SHAFT_LABELS) as ShaftType[];
export const SURFACE_STATES = Object.keys(SURFACE_LABELS) as SurfaceState[];
export const USABILITIES = Object.keys(USABILITY_LABELS) as Usability[];

/**
 * Türkçe ondalık virgülünü kabul eder. Boş veya sayı olmayan girdi için null döner.
 * Hesaplanan hiçbir değer bu yolla ölçüm olarak kaydedilmez; yalnızca kullanıcının
 * yazdığı ölçüm çevrilir.
 */
export function parseTrNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatMm(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

/** Yalnızca ekranda gösterilen bilgi amaçlı değer; kaydedilmez. */
export function diameterFromCircumference(circumference: number): number {
  return circumference / Math.PI;
}
