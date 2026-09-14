import type { ProofMember } from "@/lib/proof";

export type ShipmentGate = {
  team_id: string;
  team_code: string;
  order_id: string;
  work_order_no: string;
  order_name: string;
  customer: string | null;
  quantity: number;
  due_on: string | null;
  shipment_ready_at: string | null;
  approved_run_id: string | null;
  members: ProofMember[];
  blockers: { code: string; text: string }[];
  ready: boolean;
  shipment_id: string | null;
};

export function shipmentErrorText(message: string): string {
  if (message.includes("YETKISIZ")) return "Sevk Et yetkiniz yok.";
  if (message.includes("SEVK_EDILDI"))
    return "Bu ziyaret sevk edilerek kapatıldı; yeni işlem başlatılamaz.";
  if (message.includes("GECERSIZ")) return message.replace(/^.*GECERSIZ:\s*/, "");
  if (message.includes("BULUNAMADI")) return message.replace(/^.*BULUNAMADI:\s*/, "");
  return message;
}

export function trDate(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("tr-TR");
}

export function trDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
}
