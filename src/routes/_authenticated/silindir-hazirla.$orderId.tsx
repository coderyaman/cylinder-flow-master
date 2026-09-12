import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey } from "@/lib/orders";
import { formatMm, SURFACE_LABELS, USABILITY_LABELS } from "@/lib/cylinders";
import {
  LIFECYCLE_LABELS,
  PLANNED_OPS,
  PLANNED_OP_LABELS,
  diff,
  formatDiff,
  teamErrorText,
  type PlannedOp,
} from "@/lib/teams";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/silindir-hazirla/$orderId")({
  head: () => ({
    meta: [
      { title: "Silindirleri Hazırla — Rotagravür MES" },
      {
        name: "description",
        content:
          "Sipariş için depodaki uygun silindirleri seçin, rezerve edin ve eksik adedi yeni imalatla planlayın.",
      },
      { property: "og:title", content: "Silindirleri Hazırla — Rotagravür MES" },
      {
        property: "og:description",
        content: "Sepet, rezervasyon ve takım oluşturma ekranı.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrepareCylinders,
});

type Receipt = {
  id: string;
  cyl_code: string;
  measured_circumference_mm: number;
  measured_diameter_mm: number;
  measured_length_mm: number;
  surface_state: keyof typeof SURFACE_LABELS;
  usability: keyof typeof USABILITY_LABELS;
  lifecycle: keyof typeof LIFECYCLE_LABELS;
  status: string;
};

function PrepareCylinders() {
  const { orderId } = Route.useParams();
  const { hasPermission } = useAuth();
  const canManage = hasPermission("team.manage");
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [plannedNote, setPlannedNote] = useState("");
  const [plannedOps, setPlannedOps] = useState<PlannedOp[]>([]);

  const orderQuery = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, customers(name)")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const order = orderQuery.data;

  const candidatesQuery = useQuery({
    queryKey: ["cyl-candidates", order?.customer_id],
    enabled: !!order?.customer_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cylinder_receipts")
        .select(
          "id, cyl_code, measured_circumference_mm, measured_diameter_mm, measured_length_mm, surface_state, usability, lifecycle, status",
        )
        .eq("customer_id", order!.customer_id)
        .eq("status", "kabul");
      if (error) throw error;
      return data as unknown as Receipt[];
    },
  });

  const reservationsQuery = useQuery({
    queryKey: ["cyl-reservations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cylinder_reservations")
        .select("receipt_id, order_id, orders(work_order_no)")
        .eq("status", "aktif");
      if (error) throw error;
      return data;
    },
  });

  const cartQuery = useQuery({
    queryKey: ["cart", orderId],
    queryFn: async () => {
      const { data: cart, error } = await supabase
        .from("order_carts")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle();
      if (error) throw error;
      if (!cart) return { cart: null, items: [] as any[] };
      const { data: items, error: e2 } = await supabase
        .from("cart_items")
        .select("*, cylinder_receipts(cyl_code, measured_circumference_mm, measured_length_mm)")
        .eq("cart_id", cart.id)
        .is("removed_at", null)
        .order("created_at");
      if (e2) throw e2;
      return { cart, items: items ?? [] };
    },
  });

  const teamQuery = useQuery({
    queryKey: ["team", orderId],
    queryFn: async () => {
      const { data: team, error } = await supabase
        .from("teams")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle();
      if (error) throw error;
      if (!team) return { team: null, members: [] as any[] };
      const { data: members, error: e2 } = await supabase
        .from("team_members")
        .select("*, cylinder_receipts(cyl_code)")
        .eq("team_id", team.id)
        .eq("is_active", true)
        .order("sequence_no");
      if (e2) throw e2;
      return { team, members: members ?? [] };
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["cart", orderId] });
    qc.invalidateQueries({ queryKey: ["team", orderId] });
    qc.invalidateQueries({ queryKey: ["cyl-reservations"] });
    qc.invalidateQueries({ queryKey: ["cyl-candidates"] });
  }

  if (orderQuery.isLoading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (orderQuery.isError)
    return <p className="text-sm text-destructive">Sipariş okunamadı. Sayfayı yenileyin.</p>;
  if (!order)
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Sipariş bulunamadı</CardTitle>
          <CardDescription>Kayıt yok ya da görme yetkiniz yok.</CardDescription>
        </CardHeader>
      </Card>
    );

  const targetCirc = Number(order.nominal_circumference_mm);
  const targetLen = Number(order.target_length_mm);
  const reservedBy = new Map<string, string>();
  for (const r of reservationsQuery.data ?? [])
    reservedBy.set(r.receipt_id, (r as any).orders?.work_order_no ?? "başka sipariş");

  const items = cartQuery.data?.items ?? [];
  const inCart = new Set(items.filter((i: any) => i.receipt_id).map((i: any) => i.receipt_id));
  const chosen = items.filter((i: any) => i.kind === "mevcut").length;
  const planned = items.filter((i: any) => i.kind === "yeni_imalat").length;
  const missing = Math.max(0, order.quantity - chosen - planned);

  const candidates = [...(candidatesQuery.data ?? [])].sort((a, b) => {
    const la = Math.abs(diff(Number(a.measured_length_mm), targetLen));
    const lb = Math.abs(diff(Number(b.measured_length_mm), targetLen));
    if (la === 0 !== (lb === 0)) return la === 0 ? -1 : 1;
    const ca = Math.abs(diff(Number(a.measured_circumference_mm), targetCirc));
    const cb = Math.abs(diff(Number(b.measured_circumference_mm), targetCirc));
    if (ca !== cb) return ca - cb;
    return la - lb;
  });

  function reasonUnavailable(c: Receipt): string | null {
    if (inCart.has(c.id)) return "Bu siparişin sepetinde";
    if (reservedBy.has(c.id)) return `Ayrılmış: #${reservedBy.get(c.id)}`;
    if (c.lifecycle !== "depoda") return LIFECYCLE_LABELS[c.lifecycle];
    if (c.usability !== "kullanilabilir") return USABILITY_LABELS[c.usability];
    return null;
  }

  async function addExisting(receiptId: string) {
    setBusy(true);
    const { error } = await supabase.rpc("cart_add_existing", {
      _order_id: orderId,
      _receipt_id: receiptId,
      _planned_ops: [],
      _idempotency_key: newIdempotencyKey(),
    });
    if (!error) await supabase.rpc("team_sync_new_items", { _order_id: orderId });
    setBusy(false);
    if (error) return void toast.error(teamErrorText(error.message));
    toast.success("Silindir sepete eklendi ve rezerve edildi");
    refresh();
  }

  async function addPlanned() {
    setBusy(true);
    const { error } = await supabase.rpc("cart_add_planned", {
      _order_id: orderId,
      _planned_ops: plannedOps,
      ...(plannedNote.trim() ? { _note: plannedNote.trim() } : {}),
      _idempotency_key: newIdempotencyKey(),
    });
    if (!error) await supabase.rpc("team_sync_new_items", { _order_id: orderId });
    setBusy(false);
    if (error) return void toast.error(teamErrorText(error.message));
    setPlannedNote("");
    setPlannedOps([]);
    toast.success("Yeni imalat ihtiyacı planlandı");
    refresh();
  }

  async function removeItem(itemId: string) {
    setBusy(true);
    const { error } = await supabase.rpc("cart_remove_item", { _item_id: itemId });
    setBusy(false);
    if (error) return void toast.error(teamErrorText(error.message));
    toast.success("Sepetten çıkarıldı, rezervasyon bırakıldı");
    refresh();
  }

  async function setOps(itemId: string, ops: PlannedOp[]) {
    const { error } = await supabase.rpc("cart_set_item_ops", {
      _item_id: itemId,
      _planned_ops: ops,
    });
    if (error) return void toast.error(teamErrorText(error.message));
    refresh();
  }

  async function createTeam() {
    setBusy(true);
    const { error } = await supabase.rpc("create_team", {
      _order_id: orderId,
      _idempotency_key: newIdempotencyKey(),
    });
    setBusy(false);
    if (error) return void toast.error(teamErrorText(error.message));
    toast.success("Takım oluşturuldu. Üretim başlamadı.");
    refresh();
  }

  const team = teamQuery.data?.team;
  const members = teamQuery.data?.members ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/siparis/$orderId"
          params={{ orderId }}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Sipariş kartı
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Silindirleri Hazırla</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {order.customers?.name} · #{order.work_order_no} · {order.name}
        </p>
      </div>

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 py-5 md:grid-cols-7">
          <Field label="Gereken adet" value={String(order.quantity)} />
          <Field label="Hedef çevre" value={`${formatMm(targetCirc)} mm`} />
          <Field label="Hedef boy" value={`${formatMm(targetLen)} mm`} />
          <Field label="Mevcut seçilen" value={String(chosen)} />
          <Field label="Yeni imalat planlanan" value={String(planned)} />
          <Field label="Eksik" value={String(missing)} tone={missing > 0 ? "warn" : "ok"} />
          <div>
            <p className="text-xs uppercase text-muted-foreground">Takım</p>
            <p className="font-mono text-sm">{team ? team.team_code : "Oluşturulmadı"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Depo adayları — {order.customers?.name}</CardTitle>
          <CardDescription>
            Ölçü farkları olduğu gibi gösterilir; teknik uygunluk kararı size aittir. Yalnızca bu
            müşteriye ait, depoda ve kullanılabilir silindirler seçilebilir.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {candidatesQuery.isLoading ? (
            <p className="px-6 text-sm text-muted-foreground">Adaylar yükleniyor…</p>
          ) : candidates.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">
              Bu müşteri adına kabul edilmiş silindir kaydı yok.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">CYL kodu</th>
                    <th className="px-3 py-2 text-right">Çevre</th>
                    <th className="px-3 py-2 text-right">Çevre farkı</th>
                    <th className="px-3 py-2 text-right">Çap</th>
                    <th className="px-3 py-2 text-right">Boy</th>
                    <th className="px-3 py-2 text-right">Boy farkı</th>
                    <th className="px-3 py-2 text-left">Yüzey</th>
                    <th className="px-3 py-2 text-left">Kullanılabilirlik</th>
                    <th className="px-3 py-2 text-left">Durum</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => {
                    const blocked = reasonUnavailable(c);
                    const dc = diff(Number(c.measured_circumference_mm), targetCirc);
                    const dl = diff(Number(c.measured_length_mm), targetLen);
                    return (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="px-3 py-1.5 font-mono">{c.cyl_code}</td>
                        <td className="px-3 py-1.5 text-right">
                          {formatMm(c.measured_circumference_mm)}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tabular-nums ${dc === 0 ? "text-muted-foreground" : "font-medium"}`}
                        >
                          {formatDiff(dc)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {formatMm(c.measured_diameter_mm)}
                        </td>
                        <td className="px-3 py-1.5 text-right">{formatMm(c.measured_length_mm)}</td>
                        <td
                          className={`px-3 py-1.5 text-right tabular-nums ${dl === 0 ? "text-muted-foreground" : "font-medium"}`}
                        >
                          {formatDiff(dl)}
                        </td>
                        <td className="px-3 py-1.5">{SURFACE_LABELS[c.surface_state]}</td>
                        <td className="px-3 py-1.5">
                          {c.usability === "kullanilabilir" ? (
                            USABILITY_LABELS[c.usability]
                          ) : (
                            <Badge variant="destructive">{USABILITY_LABELS[c.usability]}</Badge>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {blocked ? (
                            <Badge variant="outline">{blocked}</Badge>
                          ) : (
                            <span className="text-muted-foreground">Serbest</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canManage || !!blocked || busy}
                            onClick={() => addExisting(c.id)}
                          >
                            Sepete ekle
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sepet</CardTitle>
          <CardDescription>
            Sepet sunucuda saklanır; sayfa yenilense de korunur. Planlanan ek işler yapılmış
            operasyon değildir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sepet boş.</p>
          ) : (
            <div className="space-y-2">
              {items.map((it: any) => (
                <div key={it.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={it.kind === "mevcut" ? "secondary" : "outline"}>
                      {it.kind === "mevcut" ? "Mevcut silindir" : "Yeni imalat (planlanan)"}
                    </Badge>
                    <span className="font-mono text-sm">
                      {it.cylinder_receipts?.cyl_code ?? "— henüz fiziksel silindir yok —"}
                    </span>
                    {it.cylinder_receipts && (
                      <span className="text-xs text-muted-foreground">
                        Çevre {formatMm(it.cylinder_receipts.measured_circumference_mm)} · Boy{" "}
                        {formatMm(it.cylinder_receipts.measured_length_mm)}
                      </span>
                    )}
                    {it.note && <span className="text-xs text-muted-foreground">· {it.note}</span>}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      disabled={!canManage || busy}
                      onClick={() => removeItem(it.id)}
                    >
                      Sepetten çıkar
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {PLANNED_OPS.map((op) => {
                      const on = (it.planned_ops ?? []).includes(op);
                      return (
                        <label key={op} className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={!canManage}
                            onChange={() =>
                              setOps(
                                it.id,
                                on
                                  ? (it.planned_ops ?? []).filter((x: PlannedOp) => x !== op)
                                  : [...(it.planned_ops ?? []), op],
                              )
                            }
                          />
                          {PLANNED_OP_LABELS[op]}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-md border border-dashed p-3">
            <p className="text-sm font-medium">Yeni İmalat Ekle</p>
            <p className="text-xs text-muted-foreground">
              Bu yalnızca planlanan ihtiyaç kaydıdır. Depo stoğu, CYL kimliği veya QR oluşturmaz;
              gerçek silindir Torna tamamlanınca sonraki aşamalarda doğar.
            </p>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <div className="min-w-[240px] flex-1">
                <Label htmlFor="imalat-not" className="text-xs">
                  Not (isteğe bağlı)
                </Label>
                <Input
                  id="imalat-not"
                  value={plannedNote}
                  onChange={(e) => setPlannedNote(e.target.value)}
                  placeholder="Ör. çevre hedefe göre yeni imalat"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                {PLANNED_OPS.map((op) => (
                  <label key={op} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={plannedOps.includes(op)}
                      onChange={() =>
                        setPlannedOps((p) =>
                          p.includes(op) ? p.filter((x) => x !== op) : [...p, op],
                        )
                      }
                    />
                    {PLANNED_OP_LABELS[op]}
                  </label>
                ))}
              </div>
              <Button variant="outline" disabled={!canManage || busy} onClick={addPlanned}>
                Yeni İmalat Ekle
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <p className="text-sm text-muted-foreground">
              Gereken {order.quantity} · seçilen {chosen} · planlanan {planned} · eksik {missing}
            </p>
            <Button
              className="ml-auto"
              disabled={!canManage || busy || missing > 0 || !!team}
              onClick={createTeam}
            >
              Takımı Oluştur
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Takımı oluşturmak üretimi başlatmaz. Taslak sepet eksikken de saklanır.
          </p>
        </CardContent>
      </Card>

      {team && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Takım <span className="font-mono">{team.team_code}</span>
            </CardTitle>
            <CardDescription>
              Üretim başlamadığı sürece üyeler değiştirilebilir; değişiklikler denetim kaydında
              korunur.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <table className="w-full text-sm">
              <thead className="border-y bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Sıra</th>
                  <th className="px-3 py-2 text-left">Tür</th>
                  <th className="px-3 py-2 text-left">Silindir</th>
                  <th className="px-3 py-2 text-left">Planlanan ek işler</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m: any) => (
                  <tr key={m.id} className="border-b last:border-0">
                    <td className="px-3 py-1.5">{m.sequence_no}</td>
                    <td className="px-3 py-1.5">
                      {m.kind === "mevcut" ? "Mevcut" : "Yeni imalat (planlanan)"}
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {m.cylinder_receipts?.cyl_code ?? "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      {(m.planned_ops ?? []).length === 0
                        ? "—"
                        : (m.planned_ops as PlannedOp[])
                            .map((op) => PLANNED_OP_LABELS[op])
                            .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "ok";
}) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p
        className={`text-sm font-medium ${tone === "warn" ? "text-destructive" : tone === "ok" ? "text-primary" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
