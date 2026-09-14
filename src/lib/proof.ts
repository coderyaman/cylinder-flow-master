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

export type MemberIssue = {
  code: string;
  text: string;
  issue_id?: string | null;
};

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
  has_plan: boolean;
  next_step: {
    step_id: string;
    station_code: string;
    station_name: string;
    op_label: string;
    status: string;
  } | null;
  open_op: {
    operation_id: string;
    station_code: string;
    station_name: string;
    status: string;
  } | null;
  open_issue: {
    issue_id: string;
    status: string;
    severity: string;
    decision: string | null;
    proof_run_id: string | null;
    description: string;
  } | null;
  issues: MemberIssue[];
};

export type PendingDecision = {
  issue_id: string;
  status: string;
  severity: string;
  description: string;
  proof_run_id: string | null;
  requested_at: string;
  stage_no: number | null;
  cyl_code: string | null;
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
  pending_decisions: PendingDecision[];
  blocked_at: string | null;
  blocked_reason: string | null;
  ready: boolean;
  active_run_id: string | null;
  fingerprint: string;
  shipment_ready_at: string | null;
  approval_valid: boolean;
  approved_run_id: string | null;
};

/** Eksik açıklaması; bazı durumlarda sunucu metnini netleştirir. */
export function issueText(m: ProofMember, issue: MemberIssue): string {
  if (issue.code === "HAZIR_DEGIL" && !m.next_step) {
    return "Prova İçin Hazır değil: rotada bekleyen adım yok, rotaya Krom adımı eklenip üretime alınmalı.";
  }
  return issue.text;
}

/** Eksik nedeninin sonraki işlemi: hangi ekran, hangi rol. */
export function memberAction(
  m: ProofMember,
  issue: MemberIssue,
  orderId: string,
): { label: string; to: string; role: string } | { label: null; to: null; role: string } {
  switch (issue.code) {
    case "PLANLANAN":
      return {
        label: "İmalat işini aç",
        to: "/operator",
        role: "Torna operatörü (yeni imalat)",
      };
    case "URETIME_ALINMADI":
      return {
        label: "Üretime alma ekranını aç",
        to: `/rota/${orderId}`,
        role: "Yetkili Asistan / Müdür (üretime alma)",
      };
    case "ROTA":
      return {
        label: "Operasyonu aç",
        to:
          m.next_step && m.next_step.status === "kuyrukta"
            ? `/operator/is/${m.next_step.step_id}`
            : "/kuyruk",
        role: `${m.next_step?.station_name ?? "İlgili istasyon"} operatörü`,
      };
    case "ACIK_IS":
      return {
        label: "Operasyonu aç",
        to: m.open_op ? `/operator/aktif/${m.open_op.operation_id}` : "/operator",
        role: `${m.open_op?.station_name ?? "İlgili istasyon"} operatörü`,
      };
    case "KADEME":
      return { label: "Operasyonu aç", to: "/kuyruk", role: "Taşlama operatörü" };
    case "HAZIR_DEGIL":
      // Bekleyen adım yoksa rota son (Krom) adımı eksik demektir.
      return m.next_step
        ? { label: "Operasyonu aç", to: "/kuyruk", role: "Krom operatörü" }
        : {
            label: "Üretime alma ekranını aç",
            to: `/rota/${orderId}`,
            role: "Yetkili Asistan / Müdür",
          };
    case "KARAR_BEKLIYOR":
      return {
        label: "Kalite kaydını aç",
        to: `/kalite?issue=${issue.issue_id ?? ""}`,
        role: "Müdür (kalite kararı)",
      };
    default:
      return { label: null, to: null, role: "Yetkili" };
  }
}


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
