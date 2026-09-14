import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey } from "@/lib/orders";
import { trDate, trDateTime } from "@/lib/shipment";
import {
  BILLING_GROUPS,
  accountingErrorText,
  groupSummary,
  sourceText,
  type AccountingDetail,
  type AccountingItem,
  type BillingClass,
} from "@/lib/accounting";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/muhasebe")({
  head: () => ({
    meta: [
      { title: "Muhasebe — Rotagravür MES" },
      {
        name: "description",
        content:
          "Sevk edilen ve üretim görmüş iptal siparişlerinin gerçekleşen işlerini ticari gruplarıyla görün, Muhasebede İşlendi olarak kapatın.",
      },
      { property: "og:title", content: "Muhasebe — Rotagravür MES" },
      {
        property: "og:description",
        content: "Gerçekleşen işlerin ticari değerlendirmesi ve muhasebe işleme kaydı.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountingScreen,
});

type PackageRow = {
  id: string;
  order_id: string;
  trigger: string;
  status: "bekliyor" | "islendi";
  needs_review: boolean;
  created_at: string;
  processed_at: string | null;
  processed_by_name: string | null;
  work_order_no: string;
  order_name: string;
  customer: string;
  quantity: number;
  closed_at: string | null;
};

function AccountingScreen() {
  const { hasPermission } = useAuth();
  const canProcess = hasPermission("accounting.process");
  const canOverride = hasPermission("billing.override");
  const canView = canProcess || canOverride || hasPermission("billing.decide");
  const [tab, setTab] = useState<"bekleyen" | "islenen">("bekleyen");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<PackageRow | null>(null);

  const listQuery = useQuery({
    queryKey: ["muhasebe", "paketler"],
    refetchInterval: 30000,
    enabled: canView,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounting_packages")
        .select(
          "id, order_id, trigger, status, needs_review, created_at, processed_at, processed_by, shipment_id, orders(work_order_no, name, quantity, shipped_at, cancelled_at, closure_status, customers(name)), profiles:processed_by(full_name)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((p: any): PackageRow => {
        const o = p.orders ?? {};
        return {
          id: p.id,
          order_id: p.order_id,
          trigger: p.trigger,
          status: p.status,
          needs_review: p.needs_review,
          created_at: p.created_at,
          processed_at: p.processed_at,
          processed_by_name: p.profiles?.full_name ?? null,
          work_order_no: o.work_order_no ?? "—",
          order_name: o.name ?? "—",
          customer: o.customers?.name ?? "—",
          quantity: o.quantity ?? 0,
          closed_at: o.shipped_at ?? o.cancelled_at ?? null,
        };
      });
    },
  });

  const rows = useMemo(() => {
    const all = listQuery.data ?? [];
    const needle = q.trim().toLocaleLowerCase("tr-TR");
    return all
      .filter((r) => (tab === "bekleyen" ? r.status === "bekliyor" || r.needs_review : r.status === "islendi"))
      .filter((r) =>
        !needle
          ? true
          : [r.customer, r.work_order_no, r.order_name]
              .join(" ")
              .toLocaleLowerCase("tr-TR")
              .includes(needle),
      );
  }, [listQuery.data, q, tab]);

  if (!canView) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Muhasebe</CardTitle>
            <CardDescription>
              Bu ekran için Muhasebe veya ticari karar yetkisi gerekir.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Muhasebe</h1>
        <p className="text-sm text-muted-foreground">
          Gerçekleşen işlerin ticari değerlendirmesi. Bu ekran fatura kesmez; dış muhasebe
          programında işlemek için kayıtları hazırlar.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={tab === "bekleyen" ? "default" : "outline"} onClick={() => setTab("bekleyen")}>
          Muhasebe Bekleyenler
        </Button>
        <Button variant={tab === "islenen" ? "default" : "outline"} onClick={() => setTab("islenen")}>
          İşlenenler
        </Button>
        <Input
          className="max-w-xs"
          placeholder="Firma, iş emri veya iş adı ara…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {tab === "bekleyen" ? "Muhasebe Bekleyenler" : "İşlenenler"} ({rows.length})
          </CardTitle>
          <CardDescription>
            Sevk edilmiş siparişler ve üretim görmüş iptaller. Üretim görmemiş iptaller listeye girmez.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="p-2">Firma</th>
                <th className="p-2">İş emri</th>
                <th className="p-2">İşin adı</th>
                <th className="p-2">Adet</th>
                <th className="p-2">Sevk / İptal</th>
                <th className="p-2">Kapanış</th>
                <th className="p-2">Durum</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 font-medium">{r.customer}</td>
                  <td className="p-2">{r.work_order_no}</td>
                  <td className="p-2">{r.order_name}</td>
                  <td className="p-2">{r.quantity}</td>
                  <td className="p-2">{trDate(r.closed_at)}</td>
                  <td className="p-2">{r.trigger === "iptal" ? "İptal" : "Sevk"}</td>
                  <td className="p-2">
                    {r.needs_review ? (
                      <Badge variant="destructive">Yeniden İnceleme Gerekli</Badge>
                    ) : r.status === "islendi" ? (
                      <Badge variant="secondary">
                        İşlendi · {trDateTime(r.processed_at)}
                        {r.processed_by_name ? ` · ${r.processed_by_name}` : ""}
                      </Badge>
                    ) : (
                      <Badge>Muhasebe Bekliyor</Badge>
                    )}
                  </td>
                  <td className="p-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                      Detay
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={8}>
                    Kayıt yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
          {open && (
            <OrderAccounting
              row={open}
              canProcess={canProcess}
              canOverride={canOverride}
              onClose={() => setOpen(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OrderAccounting({
  row,
  canProcess,
  canOverride,
  onClose,
}: {
  row: PackageRow;
  canProcess: boolean;
  canOverride: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [processKey] = useState(() => newIdempotencyKey());
  const [override, setOverride] = useState<AccountingItem | null>(null);

  const detailQuery = useQuery({
    queryKey: ["muhasebe", "detay", row.order_id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("accounting_items", { _order_id: row.order_id });
      if (error) throw error;
      return data as unknown as AccountingDetail;
    },
  });

  const processMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("accounting_process", {
        _order_id: row.order_id,
        _note: null,
        _idempotency_key: processKey,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Muhasebede İşlendi olarak kaydedildi.");
      await queryClient.invalidateQueries({ queryKey: ["muhasebe"] });
    },
    onError: (e: any) => toast.error(accountingErrorText(e.message ?? String(e))),
  });

  const detail = detailQuery.data;
  const items = detail?.items ?? [];

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {row.customer} · {row.work_order_no}
        </DialogTitle>
        <DialogDescription>
          {row.order_name} · {row.quantity} adet ·{" "}
          {row.trigger === "iptal" ? "Üretim görmüş iptal" : "Sevk edildi"} ·{" "}
          {trDate(row.closed_at)}
        </DialogDescription>
      </DialogHeader>

      {detail?.package?.needs_review && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <strong>Yeniden İnceleme Gerekli.</strong>{" "}
          {detail.package.review_reason ?? "Ticari kalemler işlendikten sonra değişti."} Önceki
          işleme geçmişi korunuyor.
        </div>
      )}

      {detailQuery.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
      {detailQuery.error && (
        <p className="text-sm text-destructive">
          {accountingErrorText((detailQuery.error as any).message ?? "")}
        </p>
      )}

      {BILLING_GROUPS.map((g) => {
        const groupItems = items.filter((i) => i.billing === g.key);
        return (
          <Card key={g.key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>
                  {g.label} ({groupItems.length})
                </span>
              </CardTitle>
              <CardDescription>{g.hint}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {groupItems.length > 0 && (
                <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2 text-sm">
                  <span className="flex-1">{groupSummary(groupItems)}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(groupSummary(groupItems))
                        .then(() => toast.success("Özet kopyalandı."));
                    }}
                  >
                    Kopyala
                  </Button>
                </div>
              )}
              {groupItems.length === 0 && (
                <p className="text-sm text-muted-foreground">Bu grupta kalem yok.</p>
              )}
              {groupItems.map((it) => (
                <div key={it.ref_id} className="rounded-md border p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{it.label}</span>
                    <Badge variant="outline">{it.cyl_code}</Badge>
                    {it.kind === "operation" && (
                      <Badge variant="outline">Tur {it.rework_round}</Badge>
                    )}
                    {it.result === "sorunlu" && <Badge variant="destructive">Sorunlu</Badge>}
                    <span className="ml-auto text-muted-foreground">
                      {trDateTime(it.occurred_at)}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {sourceText(it.source)}
                    {it.reason ? ` · Gerekçe: ${it.reason}` : ""}
                  </div>
                  {(it.works.length > 0 || it.bakir_works.length > 0) && (
                    <div className="mt-1 text-muted-foreground">
                      Yapılan iş: {[...it.works, ...it.bakir_works].join(", ")}
                    </div>
                  )}
                  {canOverride && (
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      onClick={() => setOverride(it)}
                    >
                      Ticari istisna
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <span className="mr-auto text-xs text-muted-foreground">
          "Muhasebede İşlendi" fatura kesildi anlamına gelmez; fiyat veya fatura numarası istemez.
        </span>
        <Button variant="outline" onClick={onClose}>
          Kapat
        </Button>
        <Button
          disabled={!canProcess || processMutation.isPending || detailQuery.isLoading}
          onClick={() => processMutation.mutate()}
        >
          Muhasebede İşlendi
        </Button>
      </div>

      <Dialog open={!!override} onOpenChange={(v) => !v && setOverride(null)}>
        <DialogContent>
          {override && (
            <OverrideForm
              orderId={row.order_id}
              item={override}
              onDone={async () => {
                setOverride(null);
                await queryClient.invalidateQueries({ queryKey: ["muhasebe"] });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function OverrideForm({
  orderId,
  item,
  onDone,
}: {
  orderId: string;
  item: AccountingItem;
  onDone: () => void | Promise<void>;
}) {
  const [billing, setBilling] = useState<BillingClass>(item.billing);
  const [reason, setReason] = useState("");
  const [key] = useState(() => newIdempotencyKey());

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("accounting_set_billing", {
        _order_id: orderId,
        _item_kind: item.kind,
        _ref_id: item.ref_id,
        _billing: billing,
        _reason: reason,
        _idempotency_key: key,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Ticari istisna gerekçesiyle kaydedildi.");
      await onDone();
    },
    onError: (e: any) => toast.error(accountingErrorText(e.message ?? String(e))),
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Ticari istisna</DialogTitle>
        <DialogDescription>
          {item.label} · {item.cyl_code}. Üretim gerçeği ve hatanın kökeni değişmez; yalnızca ticari
          değerlendirme gerekçesiyle kaydedilir.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {BILLING_GROUPS.map((g) => (
            <Button
              key={g.key}
              size="sm"
              variant={billing === g.key ? "default" : "outline"}
              onClick={() => setBilling(g.key)}
            >
              {g.label}
            </Button>
          ))}
        </div>
        <Textarea
          placeholder="Gerekçe (zorunlu)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          disabled={!reason.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Kaydet
        </Button>
      </div>
    </>
  );
}
