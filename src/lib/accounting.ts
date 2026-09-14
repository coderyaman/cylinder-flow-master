export type BillingClass =
  | "faturalandirilabilir"
  | "faturalandirilmayacak"
  | "karar_bekliyor";

export type AccountingItem = {
  kind: "operation" | "proof_run";
  ref_id: string;
  label: string;
  station_code: string;
  cyl_code: string;
  member_id: string | null;
  stage_no: number | null;
  member_kind: string | null;
  round_no: number;
  rework_round: number;
  quality_issue_id: string | null;
  occurred_at: string;
  result: string | null;
  works: string[];
  bakir_works: string[];
  base_billing: BillingClass;
  billing: BillingClass;
  source: string;
  reason: string | null;
};

export type AccountingPackage = {
  id: string;
  status: "bekliyor" | "islendi";
  trigger: string;
  needs_review: boolean;
  review_reason: string | null;
  processed_at: string | null;
  processed_by: string | null;
  last_fingerprint: string | null;
};

export type AccountingDetail = {
  order_id: string;
  items: AccountingItem[];
  fingerprint: string;
  package: AccountingPackage | null;
};

export const BILLING_GROUPS: { key: BillingClass; label: string; hint: string }[] = [
  {
    key: "faturalandirilabilir",
    label: "Faturalandırılabilir",
    hint: "Onaylı ticari varsayılan veya müşteri revizyonu kaynaklı işler.",
  },
  {
    key: "faturalandirilmayacak",
    label: "Faturalandırılmayacak",
    hint: "İç hata kaynaklı rework ve ücretsiz tanımlı işler.",
  },
  {
    key: "karar_bekliyor",
    label: "Ticari karar bekliyor",
    hint: "Ticari varsayılanı tanımsız veya sorumluluğu belirsiz işler.",
  },
];

export function billingLabel(v: BillingClass): string {
  return BILLING_GROUPS.find((g) => g.key === v)?.label ?? v;
}

export function sourceText(source: string): string {
  switch (source) {
    case "varsayilan":
      return "İşlem tanımındaki onaylı ticari varsayılan";
    case "rework_ic_hata":
      return "İç hata kaynaklı rework (ücretsiz)";
    case "rework_musteri_revizyonu":
      return "Müşteri revizyonu kaynaklı rework (faturalandırılabilir)";
    case "rework_belirsiz":
      return "Rework sorumluluğu belirsiz";
    case "tanimsiz":
      return "Bu istasyon için onaylı ticari varsayılan tanımlı değil";
    case "istisna":
      return "Müdür ticari istisnası";
    default:
      return source;
  }
}

/** Grup içindeki kalemlerin kopyalanabilir özeti: "Gravür ×2, Bakır Kaplama ×3". */
export function groupSummary(items: AccountingItem[]): string {
  const counts = new Map<string, number>();
  for (const it of items) {
    const name = it.label.split(" — ")[0] ?? it.label;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([n, c]) => `${n} ×${c}`).join(", ");
}

export function accountingErrorText(message: string): string {
  if (message.includes("YETKISIZ")) return "Bu işlem için yetkiniz yok.";
  if (message.includes("GECERSIZ")) return message.replace(/^.*GECERSIZ:\s*/, "");
  if (message.includes("BULUNAMADI")) return message.replace(/^.*BULUNAMADI:\s*/, "");
  return message;
}
