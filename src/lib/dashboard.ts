/** Aşama 12 — Dashboard tipleri. Kaynak: dash_production() ve dash_business() RPC'leri. */

export type DashKpi = {
  active_orders: number;
  wip_cylinders: number;
  planned_manufacture: number;
  not_released: number;
  ops_today: number;
  blocked_cylinders: number;
  overdue_orders: number;
  due_today_orders: number;
  received_today: number;
  cyl_today: number;
  cyl_week: number;
  cyl_month: number;
  machines_active: number;
  machines_busy: number;
  open_issues: number;
};

export type DashStation = {
  station_id: string;
  code: string;
  name: string;
  in_progress: number;
  queued: number;
  blocked: number;
  avg_queue_min: number | null;
  avg_op_min_7d: number | null;
  ops_7d: number;
};

export type DashWaiting = {
  step_id: string;
  station: string;
  station_code: string;
  op_label: string;
  queued_at: string | null;
  order_id: string;
  customer: string;
  work_order_no: string;
  order_name: string;
  cyl_code: string | null;
  stage_no: number | null;
  team_code: string;
  due_on: string | null;
  priority: string;
};

export type DashDeadline = {
  order_id: string;
  customer: string;
  work_order_no: string;
  order_name: string;
  quantity: number;
  due_on: string | null;
  priority: string;
  bucket: "gecikti" | "bugun" | "yaklasan" | "ileri";
  active_members: number;
  blocked_members: number;
};

export type DashQuality = {
  issue_id: string;
  status: string;
  severity: string;
  category: string | null;
  description: string;
  responsibility: string;
  billable: boolean | null;
  detected_station: string;
  requested_at: string;
  proof_run_id: string | null;
  cyl_code: string | null;
  order_id: string;
  customer: string;
  work_order_no: string;
  order_name: string;
  team_code: string;
};

export type DashWaiter = {
  team_id: string;
  team_code: string;
  order_id: string;
  customer: string;
  work_order_no: string;
  order_name: string;
  due_on: string | null;
  stage_no: number | null;
  cyl_code: string | null;
  member_kind: string;
  reason: string;
  next_step: string | null;
  issue_id: string | null;
};

export type DashMachine = {
  machine_id: string;
  name: string;
  code: string;
  station: string;
  is_active: boolean;
  busy: boolean;
  ops_today: number;
  minutes_today: number;
  ops_week: number;
  minutes_week: number;
};

export type DashProduction = {
  generated_at: string;
  today: string;
  kpi: DashKpi;
  stations: DashStation[];
  waiting: DashWaiting[];
  deadlines: DashDeadline[];
  quality: DashQuality[];
  team_waiters: DashWaiter[];
  machines: DashMachine[];
};

export type DashBusiness = {
  from: string;
  to: string;
  generated_at: string;
  totals: {
    completed_orders: number;
    shipped_orders: number;
    shipped_teams: number;
    shipped_cylinders: number;
    unique_cylinders: number;
    completed_operations: number;
    proof_runs: number;
    proof_cylinders: number;
    work_items: number;
    rework_events_internal: number;
    rework_events_customer: number;
    rework_events_unknown: number;
    rework_operations: number;
    on_time_shipments: number;
  };
  billing: Record<string, number>;
  accounting: { bekliyor: number; islendi: number; needs_review: number };
  stations: { code: string; name: string; operations: number; minutes: number }[];
  customers: {
    customer_id: string;
    customer: string;
    orders: number;
    cylinders: number;
    operations: number;
    work_items: number;
    rework_operations: number;
    shipped_teams: number;
    shipped_cylinders: number;
  }[];
  shipments: {
    shipment_id: string;
    order_id: string;
    shipped_at: string;
    cylinders: number;
    customer: string;
    work_order_no: string;
    order_name: string;
    due_on: string | null;
    on_time: boolean;
  }[];
};

export function ageText(from: string | null, now: number): string {
  if (!from) return "—";
  const mins = Math.max(0, Math.round((now - new Date(from).getTime()) / 60000));
  if (mins < 60) return `${mins} dk`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} sa ${mins % 60} dk`;
  return `${Math.floor(h / 24)} gün ${h % 24} sa`;
}

export function minText(v: number | null | undefined): string {
  if (v === null || v === undefined) return "Veri eksik";
  if (v < 60) return `${v} dk`;
  return `${Math.floor(v / 60)} sa ${Math.round(v % 60)} dk`;
}

export function trTime(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  });
}

export function trDateOnly(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v + (v.length === 10 ? "T00:00:00" : "")).toLocaleDateString("tr-TR");
}

export function isoDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(d);
}

export type PeriodKey = "bugun" | "hafta" | "ay" | "ozel";

export function periodRange(key: PeriodKey): { from: string; to: string } {
  const today = isoDay(new Date());
  const d = new Date(today + "T00:00:00");
  if (key === "bugun") return { from: today, to: today };
  if (key === "hafta") {
    const dow = (d.getDay() + 6) % 7;
    const start = new Date(d);
    start.setDate(d.getDate() - dow);
    return { from: isoDay(start), to: today };
  }
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  return { from: isoDay(start), to: today };
}

export function dashErrorText(message: string): string {
  if (message.includes("YETKISIZ")) return "Bu özet için yetkiniz yok.";
  if (message.includes("GECERSIZ")) return message.replace(/^.*GECERSIZ:\s*/, "");
  return message;
}
