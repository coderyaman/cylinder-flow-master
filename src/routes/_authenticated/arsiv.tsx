import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { formatMm } from "@/lib/cylinders";
import { trDate, trDateTime } from "@/lib/shipment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const searchSchema = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/_authenticated/arsiv")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Arşiv — Rotagravür MES" },
      {
        name: "description",
        content:
          "Sevk edilmiş siparişlerin geçmişi: takım üyeleri, silindir kodları, ölçüler, Prova turları ve sevk bilgileri salt okunur.",
      },
      { property: "og:title", content: "Arşiv — Rotagravür MES" },
      {
        property: "og:description",
        content: "Sevk edilmiş siparişlerde firma, iş emri, iş adı, CYL ve sevk tarihiyle arama.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ArchiveScreen,
});

function ArchiveScreen() {
  const search = Route.useSearch();
  const [q, setQ] = useState(search.q ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["arsiv", "liste"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select(
          "id, shipped_at, member_count, order_id, team_id, teams(team_code), orders(work_order_no, name, quantity, due_on, customers(name)), shipment_items(cyl_code, stage_no)",
        )
        .order("shipped_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const term = q.trim().toLocaleLowerCase("tr-TR");
  const rows = (listQuery.data ?? []).filter((s: any) => {
    const day = (s.shipped_at ?? "").slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (!term) return true;
    const hay = [
      s.orders?.customers?.name,
      s.orders?.work_order_no,
      s.orders?.name,
      s.teams?.team_code,
      ...(s.shipment_items ?? []).map((i: any) => i.cyl_code),
    ]
      .join(" ")
      .toLocaleLowerCase("tr-TR");
    return hay.includes(term);
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Arşiv</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sevk edilmiş siparişler aynı kayıtlar üzerinden salt okunur görünür; hiçbir geçmiş
          silinmez.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[18rem] flex-1">
          <label className="text-xs text-muted-foreground">Firma, iş emri, iş adı veya CYL</label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Sevk tarihi (baş.)</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Sevk tarihi (bit.)</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sevk edilmiş siparişler ({rows.length})</CardTitle>
          <CardDescription>Satıra basınca o siparişin sevk geçmişi açılır.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-border bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Firma</th>
                  <th className="px-3 py-2 text-left">İş emri</th>
                  <th className="px-3 py-2 text-left">İşin adı</th>
                  <th className="px-3 py-2 text-left">Takım</th>
                  <th className="px-3 py-2 text-right">Adet</th>
                  <th className="px-3 py-2 text-left">Termin</th>
                  <th className="px-3 py-2 text-left">Sevk tarihi</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading && (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={8}>
                      Yükleniyor…
                    </td>
                  </tr>
                )}
                {!listQuery.isLoading && rows.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={8}>
                      Aramaya uyan arşiv kaydı yok.
                    </td>
                  </tr>
                )}
                {rows.map((s: any) => (
                  <tr key={s.id} className="border-b border-border/60">
                    <td className="px-3 py-2 font-medium">{s.orders?.customers?.name ?? "—"}</td>
                    <td className="px-3 py-2 font-mono">{s.orders?.work_order_no}</td>
                    <td className="px-3 py-2">{s.orders?.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{s.teams?.team_code}</td>
                    <td className="px-3 py-2 text-right">{s.member_count}</td>
                    <td className="px-3 py-2">{trDate(s.orders?.due_on)}</td>
                    <td className="px-3 py-2">{trDateTime(s.shipped_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOpen(open === s.id ? null : s.id)}
                      >
                        {open === s.id ? "Kapat" : "Geçmiş"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {open && <ArchiveDetail shipmentId={open} />}
    </div>
  );
}

function ArchiveDetail({ shipmentId }: { shipmentId: string }) {
  const detail = useQuery({
    queryKey: ["arsiv", "detay", shipmentId],
    queryFn: async () => {
      const { data: ship, error } = await supabase
        .from("shipments")
        .select(
          "id, shipped_at, note, order_id, team_id, member_count, orders(id, work_order_no, name, quantity, due_on, ordered_on, customers(name)), shipment_items(cyl_code, stage_no, circumference_mm, diameter_mm, length_mm, receipt_id)",
        )
        .eq("id", shipmentId)
        .single();
      if (error) throw error;

      const [{ data: runs }, { data: members }, { data: assets }, { data: pkg }] =
        await Promise.all([
          supabase
            .from("proof_runs")
            .select("id, round_no, result, status, started_at, finished_at, note")
            .eq("team_id", ship.team_id)
            .order("round_no"),
          supabase
            .from("team_members")
            .select(
              "id, is_active, stage_no, removed_at, removed_reason, cylinder_receipts(cyl_code)",
            )
            .eq("team_id", ship.team_id),
          supabase
            .from("graphic_assets")
            .select("revision_no, filename, uploaded_at, is_current")
            .eq("order_id", ship.order_id)
            .order("revision_no"),
          supabase
            .from("accounting_packages")
            .select("id, status, created_at")
            .eq("shipment_id", shipmentId),
        ]);

      const memberIds = (members ?? []).map((m: any) => m.id);
      const { data: ops } = memberIds.length
        ? await supabase
            .from("operations")
            .select("id, op_label, round_no, status, result, started_at, finished_at")
            .in("team_member_id", memberIds)
            .order("started_at")
        : { data: [] as any[] };
      const { data: issues } = memberIds.length
        ? await supabase
            .from("quality_issues")
            .select("id, category_code, description, status, decision, requested_at")
            .in("team_member_id", memberIds)
            .order("requested_at")
        : { data: [] as any[] };

      return { ship, runs: runs ?? [], members: members ?? [], assets: assets ?? [], ops: ops ?? [], issues: issues ?? [], pkg: pkg ?? [] };
    },
  });

  if (detail.isLoading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (!detail.data) return null;
  const { ship, runs, members, assets, ops, issues, pkg } = detail.data as any;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {ship.orders?.customers?.name} · {ship.orders?.work_order_no} · {ship.orders?.name}
        </CardTitle>
        <CardDescription>
          Sevk: {trDateTime(ship.shipped_at)} · {ship.member_count} silindir · Muhasebe kaydı:{" "}
          {pkg.length > 0 ? `${pkg.length} adet (${pkg[0].status})` : "yok"}
          {" · "}
          <Link to="/siparis/$orderId" params={{ orderId: ship.order_id }} className="underline">
            Sipariş kartı
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <section>
          <h3 className="mb-2 font-semibold">Sevk edilen silindirler</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Kademe</th>
                  <th className="px-3 py-2 text-left">CYL</th>
                  <th className="px-3 py-2 text-right">Çevre</th>
                  <th className="px-3 py-2 text-right">Çap</th>
                  <th className="px-3 py-2 text-right">Boy</th>
                </tr>
              </thead>
              <tbody>
                {ship.shipment_items
                  .slice()
                  .sort((a: any, b: any) => (a.stage_no ?? 0) - (b.stage_no ?? 0))
                  .map((i: any, idx: number) => (
                    <tr key={idx} className="border-t border-border/60">
                      <td className="px-3 py-2">{i.stage_no ?? "—"}</td>
                      <td className="px-3 py-2 font-mono">
                        {i.cyl_code ? (
                          <Link
                            to="/silindir/$cylCode"
                            params={{ cylCode: i.cyl_code }}
                            className="underline"
                          >
                            {i.cyl_code}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{formatMm(i.circumference_mm)}</td>
                      <td className="px-3 py-2 text-right">{formatMm(i.diameter_mm)}</td>
                      <td className="px-3 py-2 text-right">{formatMm(i.length_mm)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 font-semibold">Takım üyelikleri (tarihsel)</h3>
            <ul className="space-y-1">
              {members.map((m: any) => (
                <li key={m.id} className="flex items-center gap-2">
                  <Badge variant={m.is_active ? "secondary" : "outline"}>
                    {m.is_active ? "Sevk edilen" : "Çıkarılmış"}
                  </Badge>
                  <span className="font-mono">{m.cylinder_receipts?.cyl_code ?? "Planlanan"}</span>
                  <span className="text-muted-foreground">
                    kademe {m.stage_no ?? "—"}
                    {m.removed_reason ? ` · ${m.removed_reason}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Prova turları</h3>
            <ul className="space-y-1">
              {runs.length === 0 && <li className="text-muted-foreground">Kayıt yok.</li>}
              {runs.map((r: any) => (
                <li key={r.id}>
                  Tur {r.round_no} · {r.result ?? r.status} · {trDateTime(r.finished_at)}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 font-semibold">PDF revizyonları</h3>
            <ul className="space-y-1">
              {assets.length === 0 && <li className="text-muted-foreground">Dosya yok.</li>}
              {assets.map((a: any) => (
                <li key={a.revision_no}>
                  Rev {a.revision_no} · {a.filename} · {trDateTime(a.uploaded_at)}
                  {a.is_current ? " · güncel" : ""}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 font-semibold">Kalite / rework</h3>
            <ul className="space-y-1">
              {issues.length === 0 && <li className="text-muted-foreground">Kayıt yok.</li>}
              {issues.map((i: any) => (
                <li key={i.id}>
                  {i.category_code} · {i.status}
                  {i.decision ? ` · ${i.decision}` : ""} · {i.description}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-semibold">Operasyonlar ({ops.length})</h3>
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            <table className="w-full">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">İşlem</th>
                  <th className="px-3 py-2 text-left">Tur</th>
                  <th className="px-3 py-2 text-left">Durum</th>
                  <th className="px-3 py-2 text-left">Sonuç</th>
                  <th className="px-3 py-2 text-left">Başlangıç</th>
                  <th className="px-3 py-2 text-left">Bitiş</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((o: any) => (
                  <tr key={o.id} className="border-t border-border/60">
                    <td className="px-3 py-2">{o.op_label}</td>
                    <td className="px-3 py-2">{o.round_no}</td>
                    <td className="px-3 py-2">{o.status}</td>
                    <td className="px-3 py-2">{o.result ?? "—"}</td>
                    <td className="px-3 py-2">{trDateTime(o.started_at)}</td>
                    <td className="px-3 py-2">{trDateTime(o.finished_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
