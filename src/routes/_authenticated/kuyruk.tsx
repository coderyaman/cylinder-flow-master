import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { PLANNED_OP_LABELS, type PlannedOp } from "@/lib/teams";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/kuyruk")({
  head: () => ({
    meta: [
      { title: "İstasyon Kuyrukları — Operon" },
      {
        name: "description",
        content:
          "Üretime alınmış silindirlerin bekledikleri ilk istasyon kuyruklarını firma, iş emri, işlem ve bekleme süresiyle görün.",
      },
      { property: "og:title", content: "İstasyon Kuyrukları — Operon" },
      {
        property: "og:description",
        content: "İstasyon bazında bekleyen işler ve öncelikler.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QueuesScreen,
});

const PRIORITY_LABELS: Record<string, string> = {
  normal: "Normal",
  yuksek: "Yüksek",
  acil: "Acil",
};

function waitText(from: string | null): string {
  if (!from) return "—";
  const mins = Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 60000));
  if (mins < 60) return `${mins} dk`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} sa ${mins % 60} dk`;
  return `${Math.floor(h / 24)} gün ${h % 24} sa`;
}

function QueuesScreen() {
  const [q, setQ] = useState("");

  const queueQuery = useQuery({
    queryKey: ["kuyruk"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("route_steps")
        .select(
          "id, op_label, queued_at, queue_rank, station_id, stations(code, name, sort_order), route_plans(team_members(kind, planned_ops, cylinder_receipts(cyl_code), teams(team_code, orders(work_order_no, name, priority, critical_note, customers(name)))))",
        )
        .eq("status", "kuyrukta")
        .order("queue_rank", { ascending: true, nullsFirst: false })
        .order("queued_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = (queueQuery.data ?? []).map((s: any) => {
    const m = s.route_plans?.team_members;
    const o = m?.teams?.orders;
    return {
      id: s.id,
      station: s.stations?.name ?? "—",
      sort: s.stations?.sort_order ?? 999,
      op: s.op_label,
      queued_at: s.queued_at,
      customer: o?.customers?.name ?? "—",
      work_order_no: o?.work_order_no ?? "—",
      job: o?.name ?? "",
      priority: o?.priority ?? "normal",
      critical_note: o?.critical_note ?? "",
      ident: m?.cylinder_receipts?.cyl_code ?? `Planlanan imalat · ${m?.teams?.team_code ?? ""}`,
      planned_ops: (m?.planned_ops ?? []) as PlannedOp[],
    };
  });

  const term = q.trim().toLocaleLowerCase("tr");
  const filtered = term
    ? rows.filter((r) =>
        [r.customer, r.work_order_no, r.job, r.ident].some((v) =>
          String(v).toLocaleLowerCase("tr").includes(term),
        ),
      )
    : rows;

  const stations = [...new Set(filtered.map((r) => r.station))].sort(
    (a, b) =>
      (filtered.find((r) => r.station === a)?.sort ?? 0) -
      (filtered.find((r) => r.station === b)?.sort ?? 0),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">İstasyon Kuyrukları</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Yalnızca üretime alınmış üyelerin ilk gerekli adımı burada görünür. Sonraki adımlar
          planlıdır ve kuyrukta değildir.
        </p>
      </div>

      <Input
        className="max-w-sm"
        placeholder="Firma, iş emri, iş adı veya CYL kodu ara"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {queueQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : queueQuery.isError ? (
        <p className="text-sm text-destructive">Kuyruklar okunamadı.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {rows.length === 0 ? "Kuyrukta bekleyen iş yok." : "Aramaya uyan iş yok."}
        </p>
      ) : (
        stations.map((st) => {
          const list = filtered.filter((r) => r.station === st);
          return (
            <Card key={st}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {st} <span className="text-muted-foreground">({list.length})</span>
                </CardTitle>
                <CardDescription>Bekleyen işler, kuyruğa giriş sırasına göre.</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-y bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Firma</th>
                        <th className="px-3 py-2 text-left">İş emri</th>
                        <th className="px-3 py-2 text-left">Kimlik</th>
                        <th className="px-3 py-2 text-left">Yapılacak işlem</th>
                        <th className="px-3 py-2 text-left">Ek işler</th>
                        <th className="px-3 py-2 text-left">Öncelik</th>
                        <th className="px-3 py-2 text-left">Bekleme</th>
                        <th className="px-3 py-2 text-left">Kritik not</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="px-3 py-1.5">{r.customer}</td>
                          <td className="px-3 py-1.5 font-mono">{r.work_order_no}</td>
                          <td className="px-3 py-1.5 font-mono">{r.ident}</td>
                          <td className="px-3 py-1.5">{r.op}</td>
                          <td className="px-3 py-1.5">
                            {r.planned_ops.length === 0
                              ? "—"
                              : r.planned_ops.map((o) => PLANNED_OP_LABELS[o]).join(", ")}
                          </td>
                          <td className="px-3 py-1.5">
                            {r.priority === "normal" ? (
                              PRIORITY_LABELS[r.priority]
                            ) : (
                              <Badge variant="destructive">{PRIORITY_LABELS[r.priority]}</Badge>
                            )}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">{waitText(r.queued_at)}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {r.critical_note || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <p className="text-xs text-muted-foreground">
        Operatör Başlat/Bitir, ölçüm formları, rework ve prova onayı sonraki aşamalarda gelecektir.{" "}
        <Link to="/siparisler" className="underline">
          Siparişlere dön
        </Link>
      </p>
    </div>
  );
}
