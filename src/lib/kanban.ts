/** Üretim Kanbanı: pano yalnızca mevcut rota, kuyruk ve operasyon kayıtlarını gösterir. */

export type KanbanCard = {
  kind: "cylinder";
  member_id: string;
  operation_id: string | null;
  step_id: string | null;
  order_id: string;
  team_code: string;
  customer: string;
  work_order_no: string;
  order_name: string;
  cyl_code: string | null;
  member_kind: string;
  stage_no: number | null;
  planned_ops: string[] | null;
  due_on: string | null;
  priority: string;
  critical_note: string | null;
  since: string | null;
  op_label: string;
  machine: string | null;
  operator: string | null;
  warnings: number;
  note: string | null;
  issue_id: string | null;
  machine_held: boolean;
  hold: "yonetim" | "karar" | "bloke" | null;
  rework_round: number | null;
};

export type KanbanTeamCard = {
  kind: "team";
  team_id: string;
  team_code: string;
  order_id: string;
  customer: string;
  work_order_no: string;
  order_name: string;
  due_on: string | null;
  priority: string;
  critical_note: string | null;
  quantity: number;
  active_members: number;
  ready_members: number;
  blockers: { code: string; text: string }[];
  pending_decisions: { issue_id: string; description: string }[];
  blocked_at: string | null;
  blocked_reason: string | null;
  ready: boolean;
  active_run_id: string | null;
  shipment_ready_at: string | null;
  approval_valid: boolean;
  machine?: string | null;
  operator?: string | null;
  started_at?: string | null;
  round_no?: number | null;
};

export type KanbanColumn = {
  station_id: string | null;
  code: string;
  name: string;
  sort_order: number;
  team_column: boolean;
  in_progress: any[];
  queued: any[];
  blocked: any[];
  preparing?: KanbanTeamCard[];
  ready_to_ship?: KanbanTeamCard[];
};

export type KanbanBoard = { generated_at: string; columns: KanbanColumn[] };

export type OrderMember = {
  member_id: string;
  stage_no: number | null;
  cyl_code: string | null;
  member_kind: string;
  team_code: string;
  planned_ops: string[] | null;
  state: string;
  station: string | null;
  open_op: { operation_id: string; status: string; machine: string | null; operator: string | null; started_at: string; op_label: string } | null;
  next_step: { step_id: string; station: string; status: string; op_label: string; queued_at: string | null } | null;
  issue_id: string | null;
  team_blocked_at: string | null;
  proof_ready_at: string | null;
};

export type OrderDetail = {
  order_id: string;
  work_order_no: string;
  order_name: string;
  quantity: number;
  due_on: string | null;
  priority: string;
  critical_note: string | null;
  closure_status: string;
  shipped_at: string | null;
  customer: string;
  members: OrderMember[];
  historical: {
    member_id: string;
    stage_no: number | null;
    cyl_code: string | null;
    removed_at: string | null;
    removed_reason: string | null;
    team_code: string;
  }[];
};

export const MEMBER_STATE_LABELS: Record<string, string> = {
  islemde: "İşlemde",
  bloke: "Bloke",
  kuyrukta: "Kuyrukta",
  planli: "Planlı adım (henüz kuyrukta değil)",
  planlanan: "Planlanan imalat (fiziksel silindir yok)",
  uretime_alinmadi: "Üretime alınmadı",
  prova_hazir: "Prova için hazır",
  belirsiz: "Durum belirsiz",
};

export const PRIORITY_LABELS: Record<string, string> = {
  normal: "Normal",
  yuksek: "Yüksek",
  acil: "Acil",
};

/** Kimlik: planlanan imalat fiziksel silindirle karıştırılmaz. */
export function identText(c: KanbanCard): string {
  return c.cyl_code ?? `Planlanan imalat · ${c.team_code}`;
}

export function waitText(from: string | null, now: number): string {
  if (!from) return "—";
  const mins = Math.max(0, Math.round((now - new Date(from).getTime()) / 60000));
  if (mins < 60) return `${mins} dk`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} sa ${mins % 60} dk`;
  return `${Math.floor(h / 24)} gün ${h % 24} sa`;
}

export function dueDays(due: string | null): number | null {
  if (!due) return null;
  const d = new Date(due + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export type Risk = "gecikti" | "yaklasan" | "bloke" | "normal";

/** Renk durumu anlatır; istasyonu değil. */
export function riskOf(due: string | null, blocked: boolean): Risk {
  if (blocked) return "bloke";
  const d = dueDays(due);
  if (d === null) return "normal";
  if (d < 0) return "gecikti";
  if (d <= 2) return "yaklasan";
  return "normal";
}

export const RISK_CLASS: Record<Risk, string> = {
  gecikti: "border-destructive bg-destructive/10",
  yaklasan: "border-amber-500 bg-amber-500/10",
  bloke: "border-destructive border-dashed bg-destructive/5",
  normal: "border-border bg-card",
};

export const RISK_LABEL: Record<Risk, string> = {
  gecikti: "Gecikti",
  yaklasan: "Termin yaklaşıyor",
  bloke: "Bloke",
  normal: "",
};

export const HOLD_LABELS: Record<string, string> = {
  yonetim: "Yönetim bekletmesi",
  karar: "Karar bekliyor",
  bloke: "Bloke",
};

export function kanbanErrorText(message: string): string {
  if (message.includes("YETKISIZ")) return "Bu işlem için yetkiniz yok.";
  if (message.includes("BULUNAMADI")) return message.replace(/^.*BULUNAMADI:\s*/, "");
  if (message.includes("GECERSIZ")) return message.replace(/^.*GECERSIZ:\s*/, "");
  return message;
}
