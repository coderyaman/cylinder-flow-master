import type { Database } from "@/integrations/supabase/types";

export type ProofResult = Database["public"]["Enums"]["proof_result"];

/** Prova sonuçları (PRD 13.2). Operatör yeniden üretimi onaylamaz. */
export const PROOF_RESULT_LABELS: Record<ProofResult, string> = {
  onaylandi: "Onaylandı",
  tekrar_prova: "Tekrar Prova",
  silindir_duzeltilecek: "Silindir Düzeltilecek",
  takim_yeniden: "Takım Yeniden Yapılacak",
};

export const PROOF_RESULT_HINTS: Record<ProofResult, string> = {
  onaylandi: "Geçerli takım Sevkiyata Hazır olur. Sevkiyat kaydı oluşmaz.",
  tekrar_prova: "Yeni Prova turu açılır; silindir üretim rework'ü otomatik oluşmaz.",
  silindir_duzeltilecek: "Seçilen üyeler için Müdür kararı beklenir.",
  takim_yeniden: "Güncel üyelerin tamamı kapsama girer; takım bloke olur ve Müdür kararı beklenir.",
};

export const PROOF_RESULTS = Object.keys(PROOF_RESULT_LABELS) as ProofResult[];

export type ProofMember = {
  member_id: string;
  stage_no: number | null;
  cyl_code: string | null;
  kind: string;
  receipt_id: string | null;
  proof_ready_at: string | null;
  pending_steps: number;
  open_ops: number;
  open_warnings: number;
  measurements_recorded: boolean;
  circumference_mm: number | null;
  diameter_mm: number | null;
  length_mm: number | null;
};

export type ProofGate = {
  team_id: string;
  team_code: string;
  order_id: string;
  work_order_no: string;
  order_name: string;
  quantity: number;
  due_on: string | null;
  priority: string;
  critical_note: string | null;
  customer: string | null;
  physical_members: number;
  active_members: number;
  members: ProofMember[];
  blockers: { code: string; text: string }[];
  warnings: { cyl_code: string | null; count: number; text: string }[];
  ready: boolean;
  active_run_id: string | null;
  fingerprint: string;
  shipment_ready_at: string | null;
  approval_valid: boolean;
  approved_run_id: string | null;
};

export function proofErrorText(message: string): string {
  if (message.includes("QR_UYUSMUYOR")) return "Okutulan kod bu takımın aktif üyesi değil.";
  if (message.includes("MESGUL")) return "Seçilen Prova makinesinde devam eden bir iş var.";
  if (message.includes("YETKISIZ")) return "Prova istasyonunda işlem yetkiniz yok.";
  if (message.includes("BULUNAMADI")) return message.replace(/^.*BULUNAMADI:\s*/, "");
  if (message.includes("GECERSIZ")) return message.replace(/^.*GECERSIZ:\s*/, "");
  return message;
}

export function mm(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} mm`;
}
