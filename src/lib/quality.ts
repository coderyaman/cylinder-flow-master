import type { Database } from "@/integrations/supabase/types";

export type QualityAction = Database["public"]["Enums"]["quality_action"];
export type QualityStatus = Database["public"]["Enums"]["quality_status"];
export type QualityDecision = Database["public"]["Enums"]["quality_decision"];
export type QualityResponsibility = Database["public"]["Enums"]["quality_responsibility"];

/** Operatör öneri verir; rework rotasını kendisi onaylayamaz (PRD 12.1). */
export const QUALITY_ACTION_LABELS: Record<QualityAction, string> = {
  yeniden_kontrol: "Yeniden kontrol edilsin",
  tekrar_islem: "Tekrar işlem yapılsın",
  silindir_degisimi: "Silindir değiştirilsin",
  bilinmiyor: "Önerim yok",
};
export const QUALITY_ACTIONS = Object.keys(QUALITY_ACTION_LABELS) as QualityAction[];

export const QUALITY_STATUS_LABELS: Record<QualityStatus, string> = {
  acik: "Karar bekliyor",
  bilgi_bekleniyor: "Ek bilgi bekleniyor",
  karar_verildi: "Karar verildi",
  reddedildi: "Reddedildi",
};

export const QUALITY_DECISION_LABELS: Record<QualityDecision, string> = {
  devam: "İnceleme sonrası mevcut akışa devam",
  rework: "Onaylı rework",
  silindir_degisimi: "Silindir değiştirme",
  red: "Talebi reddet",
  ek_bilgi: "Ek bilgi iste",
};
export const QUALITY_DECISIONS = Object.keys(QUALITY_DECISION_LABELS) as QualityDecision[];

/** Ticari sorumluluk; belirsiz sorumluluk otomatik sınıflandırılmaz. */
export const RESPONSIBILITY_LABELS: Record<QualityResponsibility, string> = {
  ic_hata: "İç hata (varsayılan ücretsiz)",
  musteri_revizyonu: "Müşteri revizyonu (faturalandırılabilir)",
  bilinmiyor: "Bilinmiyor (sınıflandırılmadı)",
};
export const RESPONSIBILITIES = Object.keys(RESPONSIBILITY_LABELS) as QualityResponsibility[];

export function waitingText(fromIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000));
  if (mins < 60) return `${mins} dk`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} sa ${mins % 60} dk`;
  return `${Math.floor(h / 24)} gün ${h % 24} sa`;
}

export function billableText(billable: boolean | null | undefined): string {
  if (billable === true) return "Faturalandırılabilir";
  if (billable === false) return "Ücretsiz";
  return "Sınıflandırılmadı";
}
