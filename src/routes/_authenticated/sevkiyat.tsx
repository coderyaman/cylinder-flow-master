import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey } from "@/lib/orders";
import { formatMm } from "@/lib/cylinders";
import { shipmentErrorText, trDate, trDateTime, type ShipmentGate } from "@/lib/shipment";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/sevkiyat")({
  head: () => ({
    meta: [
      { title: "Sevkiyat — Operon" },
      {
        name: "description",
        content:
          "Prova onayı almış takımları sevke hazır listesinde görün, sunucu kontrolleriyle Sevk Et ve sevk edilenleri izleyin.",
      },
      { property: "og:title", content: "Sevkiyat — Operon" },
      {
        property: "og:description",
        content: "Sevkiyata hazır ve sevk edilen siparişler, takım üyeleri ve sevk kayıtları.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ShipmentScreen,
});

type ReadyRow = {
  team_id: string;
  team_code: string;
  order_id: string;
  work_order_no: string;
  order_name: string;
  customer: string;
  quantity: number;
  members: number;
  due_on: string;
  approved_at: string | null;
  blocked: boolean;
};

function ShipmentScreen() {
  const { hasPermission } = useAuth();
  const canShip = hasPermission("shipment.confirm");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"hazir" | "sevk">("hazir");
  const [q, setQ] = useState("");
  const [openTeam, setOpenTeam] = useState<string | null>(null);

  const readyQuery = useQuery({
    queryKey: ["sevkiyat", "hazir"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select(
          "id, team_code, shipment_ready_at, blocked_at, order_id, orders(work_order_no, name, quantity, due_on, shipped_at, closure_status, customers(name)), team_members(id, is_active), shipments(id)",
        )
        .not("shipment_ready_at", "is", null);
      if (error) throw error;
      const rows: ReadyRow[] = (data ?? [])
        .filter((t: any) => (t.shipments ?? []).length === 0 && !t.orders?.shipped_at)
        .map((t: any) => ({
          team_id: t.id,
          team_code: t.team_code,
          order_id: t.order_id,
          work_order_no: t.orders?.work_order_no ?? "—",
          order_name: t.orders?.name ?? "",
          customer: t.orders?.customers?.name ?? "—",
          quantity: t.orders?.quantity ?? 0,
          members: (t.team_members ?? []).filter((m: any) => m.is_active).length,
          due_on: t.orders?.due_on ?? "",
          approved_at: t.shipment_ready_at,
          blocked: Boolean(t.blocked_at),
        }));
      return rows;
    },
  });

  const shippedQuery = useQuery({
    queryKey: ["sevkiyat", "sevk"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select(
          "id, shipped_at, member_count, order_id, shipped_by, teams(team_code), orders(work_order_no, name, quantity, due_on, customers(name))",
        )
        .order("shipped_at", { ascending: false });
      if (error) throw error;
      const ids = Array.from(
        new Set((data ?? []).map((s: any) => s.shipped_by).filter(Boolean)),
      ) as string[];
      let names: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        names = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name]));
      }
      return (data ?? []).map((s: any) => ({
        id: s.id,
        order_id: s.order_id,
        shipped_at: s.shipped_at,
        member_count: s.member_count,
        team_code: s.teams?.team_code ?? "—",
        work_order_no: s.orders?.work_order_no ?? "—",
        order_name: s.orders?.name ?? "",
        customer: s.orders?.customers?.name ?? "—",
        quantity: s.orders?.quantity ?? 0,
        due_on: s.orders?.due_on ?? "",
        shipped_by: s.shipped_by ? (names[s.shipped_by] ?? "—") : "—",
      }));
    },
  });

  const term = q.trim().toLocaleLowerCase("tr-TR");
  const match = (...vals: (string | number | null)[]) =>
    term === "" || vals.some((v) => String(v ?? "").toLocaleLowerCase("tr-TR").includes(term));

  const readyRows = (readyQuery.data ?? []).filter((r) =>
    match(r.customer, r.work_order_no, r.order_name, r.team_code),
  );
  const shippedRows = (shippedQuery.data ?? []).filter((r) =>
    match(r.customer, r.work_order_no, r.order_name, r.team_code),
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Sevkiyat</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Prova onayı sevkiyat değildir. Sevk kararı sunucuda yeniden kontrol edilir; kısmi
            sevkiyat yoktur.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={tab === "hazir" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("hazir")}
          >
            Sevkiyata Hazır ({readyRows.length})
          </Button>
          <Button
            variant={tab === "sevk" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("sevk")}
          >
            Sevk Edilenler ({shippedRows.length})
          </Button>
        </div>
      </header>

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Firma, iş emri, iş adı veya takım kodu ara"
        className="max-w-md"
      />

      {tab === "hazir" ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sevkiyata Hazır</CardTitle>
            <CardDescription>
              Geçerli Prova onayı olan takımlar. Çözülmemiş karar veya bloke varsa sevk engellenir.
            </CardDescription>
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
                    <th className="px-3 py-2 text-left">Prova onayı</th>
                    <th className="px-3 py-2 text-left">Durum</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {readyQuery.isLoading && (
                    <tr>
                      <td className="px-3 py-6 text-muted-foreground" colSpan={9}>
                        Yükleniyor…
                      </td>
                    </tr>
                  )}
                  {!readyQuery.isLoading && readyRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-muted-foreground" colSpan={9}>
                        Sevkiyata hazır takım yok.
                      </td>
                    </tr>
                  )}
                  {readyRows.map((r) => (
                    <tr key={r.team_id} className="border-b border-border/60">
                      <td className="px-3 py-2 font-medium">{r.customer}</td>
                      <td className="px-3 py-2 font-mono">{r.work_order_no}</td>
                      <td className="px-3 py-2">{r.order_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.team_code}</td>
                      <td className="px-3 py-2 text-right">
                        {r.members}/{r.quantity}
                      </td>
                      <td className="px-3 py-2">{trDate(r.due_on)}</td>
                      <td className="px-3 py-2">{trDateTime(r.approved_at)}</td>
                      <td className="px-3 py-2">
                        {r.blocked ? (
                          <Badge variant="destructive">Bloke</Badge>
                        ) : (
                          <Badge variant="secondary">Sevkiyata hazır</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" onClick={() => setOpenTeam(r.team_id)}>
                          Detay / Sevk Et
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sevk Edilenler</CardTitle>
            <CardDescription>
              Sevk kaydı; ziyaretleri kapanmış silindirler ve Muhasebe Bekliyor kaydı ile birlikte
              arşivde okunur.
            </CardDescription>
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
                    <th className="px-3 py-2 text-left">Sevk eden</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shippedRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-muted-foreground" colSpan={9}>
                        Henüz sevk kaydı yok.
                      </td>
                    </tr>
                  )}
                  {shippedRows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="px-3 py-2 font-medium">{r.customer}</td>
                      <td className="px-3 py-2 font-mono">{r.work_order_no}</td>
                      <td className="px-3 py-2">{r.order_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.team_code}</td>
                      <td className="px-3 py-2 text-right">{r.member_count}</td>
                      <td className="px-3 py-2">{trDate(r.due_on)}</td>
                      <td className="px-3 py-2">{trDateTime(r.shipped_at)}</td>
                      <td className="px-3 py-2">{r.shipped_by}</td>
                      <td className="px-3 py-2 text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link to="/arsiv" search={{ q: r.work_order_no }}>
                            Arşiv
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {openTeam && (
        <ShipDialog
          teamId={openTeam}
          canShip={canShip}
          onClose={() => setOpenTeam(null)}
          onShipped={() => {
            setOpenTeam(null);
            setTab("sevk");
            queryClient.invalidateQueries({ queryKey: ["sevkiyat"] });
            queryClient.invalidateQueries({ queryKey: ["orders"] });
          }}
        />
      )}
    </div>
  );
}

function ShipDialog({
  teamId,
  canShip,
  onClose,
  onShipped,
}: {
  teamId: string;
  canShip: boolean;
  onClose: () => void;
  onShipped: () => void;
}) {
  const idemKey = useRef(newIdempotencyKey());
  const gateQuery = useQuery({
    queryKey: ["sevkiyat", "gate", teamId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("shipment_gate", { _team_id: teamId });
      if (error) throw error;
      return data as unknown as ShipmentGate;
    },
  });

  const shipMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("ship_team", {
        _team_id: teamId,
        _idempotency_key: idemKey.current,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res) => {
      toast.success(res?.replayed ? "Bu takım zaten sevk edilmiş." : "Sevk kaydı oluşturuldu.");
      onShipped();
    },
    onError: (e: any) => toast.error(shipmentErrorText(e.message ?? String(e))),
  });

  const gate = gateQuery.data;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sevk Et</DialogTitle>
          <DialogDescription>
            Takımın tamamı birlikte sevk edilir. Plaka, araç, irsaliye ve fatura bilgisi zorunlu
            değildir.
          </DialogDescription>
        </DialogHeader>

        {gateQuery.isLoading && <p className="text-sm text-muted-foreground">Yükleniyor…</p>}
        {gateQuery.error && (
          <p className="text-sm text-destructive">
            {shipmentErrorText((gateQuery.error as any).message)}
          </p>
        )}

        {gate && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Firma</p>
                <p className="font-medium">{gate.customer ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">İş emri</p>
                <p className="font-mono">{gate.work_order_no}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">İşin adı</p>
                <p>{gate.order_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sevk edilecek adet</p>
                <p className="font-medium">
                  {gate.members.length} / {gate.quantity}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
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
                  {gate.members.map((m) => (
                    <tr key={m.member_id} className="border-t border-border/60">
                      <td className="px-3 py-2">{m.stage_no ?? "—"}</td>
                      <td className="px-3 py-2 font-mono">
                        {m.cyl_code ?? "Planlanan imalat (fiziksel değil)"}
                      </td>
                      <td className="px-3 py-2 text-right">{formatMm(m.circumference_mm)}</td>
                      <td className="px-3 py-2 text-right">{formatMm(m.diameter_mm)}</td>
                      <td className="px-3 py-2 text-right">{formatMm(m.length_mm)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {gate.blockers.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">Sevk engelleri</p>
                <ul className="mt-1 list-disc pl-5 text-sm text-destructive">
                  {gate.blockers.map((b, i) => (
                    <li key={`${b.code}-${i}`}>{b.text}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Vazgeç
              </Button>
              <Button
                disabled={!canShip || !gate.ready || shipMutation.isPending}
                onClick={() => shipMutation.mutate()}
              >
                {shipMutation.isPending ? "Sevk ediliyor…" : "Sevk Et"}
              </Button>
            </div>
            {!canShip && (
              <p className="text-right text-xs text-muted-foreground">
                Sevk Et için Asistan/Müdür yetkisi veya açık shipment.confirm izni gerekir.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
