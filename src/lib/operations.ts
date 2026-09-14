import type { Database } from "@/integrations/supabase/types";

export type OpStatus = Database["public"]["Enums"]["op_status"];
export type OpResult = Database["public"]["Enums"]["op_result"];
export type OpWork = Database["public"]["Enums"]["op_work"];
export type OpNoteKind = Database["public"]["Enums"]["op_note_kind"];

/** Torna başlangıç işleri (PRD 11.1). Planlanan iş değil, gerçekleşen iştir. */
export const OP_WORK_LABELS: Record<OpWork, string> = {
  yeni_imalat: "Yeni İmalat",
  cevre_dusurme: "Çevre Düşürme",
  cevre_yukseltme: "Çevre Yükseltme",
  mil_cakma: "Mil Çakma",
  yuzuk_degisimi: "Yüzük Değişimi",
  tamir: "Tamir",
};

export const OP_WORKS = Object.keys(OP_WORK_LABELS) as OpWork[];

export const OP_RESULT_LABELS: Record<OpResult, string> = {
  basarili: "Başarılı",
  sorunlu: "Sorunlu",
};

export const OP_NOTE_LABELS: Record<OpNoteKind, string> = {
  not: "Not",
  uyari: "Uyarı",
  bloke: "Bloke",
};

export type BakirWork = Database["public"]["Enums"]["bakir_work"];

/** Bakır'da bir operasyonda birden çok gerçekleşen iş kaydedilebilir. */
export const BAKIR_WORK_LABELS: Record<BakirWork, string> = {
  bakir_kaplama: "Bakır Kaplama",
  ana_kaplama: "Ana Kaplama",
  cevre_yukseltme: "Çevre Yükseltme",
  cevre_dusurme: "Çevre Düşürme",
  nokta_tamiri: "Nokta Tamiri",
};

export const BAKIR_WORKS = Object.keys(BAKIR_WORK_LABELS) as BakirWork[];

/** Tamamlama formu tanımlı istasyonlar. */
export const COMPLETABLE_STATIONS = [
  "TORNA",
  "SOKME",
  "BAKIR",
  "TASLAMA",
  "CFM",
  "GRAVUR",
  "KROM",
] as const;

export function opErrorText(message: string): string {
  if (message.includes("QR_UYUSMUYOR"))
    return "Okutulan kod bu işin silindiriyle eşleşmiyor.";
  if (message.includes("MESGUL")) return "Seçilen makinede devam eden bir iş var.";
  if (message.includes("BLOKE")) return "Bu silindirde açık bir bloke kaydı var.";
  if (message.includes("SIRA_ATLAMA"))
    return "Sıradaki iş yerine bu işi almak için kısa bir gerekçe yazın.";
  if (message.includes("YETKISIZ")) return "Bu istasyonda işlem yetkiniz yok.";
  if (message.includes("BULUNAMADI")) return message.replace(/^.*BULUNAMADI:\s*/, "");
  if (message.includes("GECERSIZ")) return message.replace(/^.*GECERSIZ:\s*/, "");
  return message;
}

export function elapsedText(fromIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h} sa ${mins % 60} dk` : `${mins} dk`;
}
