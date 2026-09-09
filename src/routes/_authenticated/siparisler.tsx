import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  GRAPHIC_STATUSES,
  GRAPHIC_STATUS_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  SUPPLY_STATUSES,
  SUPPLY_STATUS_LABELS,
  isLate,
  newIdempotencyKey,
  orderErrorText,
  type GraphicStatus,
  type OrderPriority,
  type SupplyStatus,
} from "@/lib/orders";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/siparisler")({
  head: () => ({
    meta: [
      { title: "Siparişler — Rotagravür MES" },
      {
        name: "description",
        content: "Müşteri siparişleri, grafik durumu, termin ve öncelik takibi.",
      },
      { property: "og:title", content: "Siparişler — Rotagravür MES" },
      { property: "og:description", content: "Sipariş listesi ve yeni sipariş açma." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrdersPage,
});

const emptyForm = {
  customer_id: "",
  work_order_no: "",
  name: "",
  quantity: "1",
  nominal_circumference_mm: "",
  target_length_mm: "",
  due_on: "",
  supply_status: "belirsiz" as SupplyStatus,
  priority: "normal" as OrderPriority,
  note: "",
  critical_note: "",
};

function OrdersPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("orders.create");
  const queryClient = useQueryClient();

  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filterCustomer, setFilterCustomer] = useState("");
  const [filterGraphic, setFilterGraphic] = useState<"" | GraphicStatus>("");
  const [showCancelled, setShowCancelled] = useState(false);

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, is_active")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: orders, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id, customer_id, work_order_no, name, quantity, due_on, graphic_status, supply_status, priority, closure_status",
        )
        .order("due_on");
      if (error) throw error;
      return data;
    },
  });

  const customerName = useMemo(() => {
    const map = new Map((customers ?? []).map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "—";
  }, [customers]);

  const visible = (orders ?? []).filter((o) => {
    if (!showCancelled && o.closure_status === "iptal") return false;
    if (filterCustomer && o.customer_id !== filterCustomer) return false;
    if (filterGraphic && o.graphic_status !== filterGraphic) return false;
    return true;
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.rpc("create_order", {
      _customer_id: form.customer_id,
      _work_order_no: form.work_order_no,
      _name: form.name,
      _quantity: Number(form.quantity),
      _nominal_circumference_mm: Number(form.nominal_circumference_mm),
      _target_length_mm: Number(form.target_length_mm),
      _due_on: form.due_on,
      _supply_status: form.supply_status,
      _priority: form.priority,
      _note: form.note,
      _critical_note: form.critical_note,
      // Çift tıklama veya ağ tekrarı ikinci bir sipariş oluşturmaz.
      _idempotency_key: newIdempotencyKey(),
    });
    setSaving(false);
    if (error) return void toast.error(orderErrorText(error.message));
    setForm(emptyForm);
    setShowForm(false);
    toast.success("Sipariş açıldı");
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Siparişler</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grafik durumu üretimi başlatmaz; üretime alma sonraki aşamada ayrı bir karardır.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Formu kapat" : "Yeni sipariş"}
          </Button>
        )}
      </div>

      {showForm && canCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Yeni sipariş</CardTitle>
            <CardDescription>
              İş emri numarası aynı müşteride tekrar edemez. Termin ve silindir adedi zorunludur.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
              <div className="space-y-1">
                <Label htmlFor="o-customer">Firma</Label>
                <select
                  id="o-customer"
                  required
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.customer_id}
                  onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                >
                  <option value="">Seçin…</option>
                  {(customers ?? [])
                    .filter((c) => c.is_active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="o-wo">İş emri no</Label>
                <Input
                  id="o-wo"
                  required
                  value={form.work_order_no}
                  onChange={(e) => setForm({ ...form, work_order_no: e.target.value })}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="o-name">İşin adı</Label>
                <Input
                  id="o-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="o-qty">Silindir adedi</Label>
                <Input
                  id="o-qty"
                  type="number"
                  min={1}
                  required
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="o-due">Termin</Label>
                <Input
                  id="o-due"
                  type="date"
                  required
                  value={form.due_on}
                  onChange={(e) => setForm({ ...form, due_on: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="o-circ">Nominal çevre (mm)</Label>
                <Input
                  id="o-circ"
                  type="number"
                  step="0.01"
                  min={0.01}
                  required
                  value={form.nominal_circumference_mm}
                  onChange={(e) =>
                    setForm({ ...form, nominal_circumference_mm: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="o-len">Boy (mm)</Label>
                <Input
                  id="o-len"
                  type="number"
                  step="0.01"
                  min={0.01}
                  required
                  value={form.target_length_mm}
                  onChange={(e) => setForm({ ...form, target_length_mm: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="o-supply">Silindir / klişe durumu</Label>
                <select
                  id="o-supply"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.supply_status}
                  onChange={(e) =>
                    setForm({ ...form, supply_status: e.target.value as SupplyStatus })
                  }
                >
                  {SUPPLY_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {SUPPLY_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="o-prio">Öncelik</Label>
                <select
                  id="o-prio"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value as OrderPriority })
                  }
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="o-note">Not</Label>
                <Textarea
                  id="o-note"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="o-crit">Kritik not</Label>
                <Textarea
                  id="o-crit"
                  value={form.critical_note}
                  onChange={(e) => setForm({ ...form, critical_note: e.target.value })}
                />
              </div>
              <Button type="submit" disabled={saving} className="sm:col-span-2">
                {saving ? "Kaydediliyor…" : "Siparişi aç"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Sipariş listesi</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={filterCustomer}
              onChange={(e) => setFilterCustomer(e.target.value)}
            >
              <option value="">Tüm firmalar</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={filterGraphic}
              onChange={(e) => setFilterGraphic(e.target.value as "" | GraphicStatus)}
            >
              <option value="">Tüm grafik durumları</option>
              {GRAPHIC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {GRAPHIC_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showCancelled}
                onChange={(e) => setShowCancelled(e.target.checked)}
              />
              İptal edilenleri göster
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">Kayıt yok.</p>
          ) : (
            <ul className="space-y-2">
              {visible.map((o) => (
                <li key={o.id}>
                  <Link
                    to="/siparis/$orderId"
                    params={{ orderId: o.id }}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:bg-accent"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {o.name}{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          #{o.work_order_no}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {customerName(o.customer_id)} · {o.quantity} silindir · termin{" "}
                        {o.due_on}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {o.closure_status === "iptal" && <Badge variant="destructive">İptal</Badge>}
                      {isLate(o.due_on, o.closure_status) && (
                        <Badge variant="destructive">Gecikmiş</Badge>
                      )}
                      {o.priority !== "normal" && (
                        <Badge variant="outline">{PRIORITY_LABELS[o.priority]}</Badge>
                      )}
                      <Badge variant="secondary">
                        {GRAPHIC_STATUS_LABELS[o.graphic_status]}
                      </Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
