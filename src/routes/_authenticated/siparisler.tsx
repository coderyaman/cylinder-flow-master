import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const PAGE_SIZE = 50;

const searchSchema = z.object({
  q: z.string().optional(),
  firma: z.string().optional(),
  grafik: z.string().optional(),
  tedarik: z.string().optional(),
  oncelik: z.string().optional(),
  terminBas: z.string().optional(),
  terminBit: z.string().optional(),
  iptal: z.boolean().optional(),
  sirala: z.enum(["due_on", "work_order_no", "name", "quantity", "ordered_on"]).optional(),
  yon: z.enum(["asc", "desc"]).optional(),
  sayfa: z.number().int().min(1).optional(),
  grup: z.enum(["yok", "grafik", "firma"]).optional(),
});

export const Route = createFileRoute("/_authenticated/siparisler")({
  validateSearch: searchSchema,
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
  ordered_on: new Date().toISOString().slice(0, 10),
  due_on: "",
  supply_status: "belirsiz" as SupplyStatus,
  priority: "normal" as OrderPriority,
  note: "",
  critical_note: "",
};

type OrderRow = {
  id: string;
  customer_id: string;
  work_order_no: string;
  name: string;
  quantity: number;
  nominal_circumference_mm: number;
  target_length_mm: number;
  due_on: string;
  ordered_on: string;
  graphic_status: GraphicStatus;
  supply_status: SupplyStatus;
  priority: OrderPriority;
  closure_status: "acik" | "iptal";
  note: string | null;
  critical_note: string | null;
  customers: { name: string } | null;
};

function OrdersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("orders.create");
  const queryClient = useQueryClient();

  const page = search.sayfa ?? 1;
  const sortKey = search.sirala ?? "due_on";
  const sortDir = search.yon ?? "asc";
  const grouping = search.grup ?? "yok";

  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const createKey = useRef<string>(newIdempotencyKey());

  const setSearch = (patch: Partial<z.infer<typeof searchSchema>>, resetPage = true) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch, ...(resetPage ? { sayfa: 1 } : {}) }),
      replace: true,
    });

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

  const ordersQuery = useQuery({
    queryKey: ["orders", search],
    queryFn: async () => {
      let matchedCustomerIds: string[] = [];
      const term = (search.q ?? "").trim();
      if (term) {
        const { data: cs } = await supabase
          .from("customers")
          .select("id")
          .ilike("name", `%${term}%`);
        matchedCustomerIds = (cs ?? []).map((c) => c.id);
      }

      let query = supabase
        .from("orders")
        .select(
          "id, customer_id, work_order_no, name, quantity, nominal_circumference_mm, target_length_mm, due_on, ordered_on, graphic_status, supply_status, priority, closure_status, note, critical_note, customers(name)",
          { count: "exact" },
        );

      if (!search.iptal) query = query.neq("closure_status", "iptal");
      if (search.firma) query = query.eq("customer_id", search.firma);
      if (search.grafik) query = query.eq("graphic_status", search.grafik as GraphicStatus);
      if (search.tedarik) query = query.eq("supply_status", search.tedarik as SupplyStatus);
      if (search.oncelik) query = query.eq("priority", search.oncelik as OrderPriority);
      if (search.terminBas) query = query.gte("due_on", search.terminBas);
      if (search.terminBit) query = query.lte("due_on", search.terminBit);
      if (term) {
        const parts = [`work_order_no.ilike.%${term}%`, `name.ilike.%${term}%`];
        if (matchedCustomerIds.length > 0)
          parts.push(`customer_id.in.(${matchedCustomerIds.join(",")})`);
        query = query.or(parts.join(","));
      }

      const from = (page - 1) * PAGE_SIZE;
      const { data, error, count } = await query
        .order(sortKey, { ascending: sortDir === "asc" })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;

      const rows = (data ?? []) as unknown as OrderRow[];
      const revisions = new Map<string, number>();
      if (rows.length > 0) {
        const { data: assets } = await supabase
          .from("graphic_assets")
          .select("order_id, revision_no")
          .eq("is_current", true)
          .in(
            "order_id",
            rows.map((r) => r.id),
          );
        for (const a of assets ?? []) revisions.set(a.order_id, a.revision_no);
      }
      return { rows, total: count ?? 0, revisions };
    },
  });

  const rows = ordersQuery.data?.rows ?? [];
  const total = ordersQuery.data?.total ?? 0;
  const revisions = ordersQuery.data?.revisions;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive =
    !!search.q ||
    !!search.firma ||
    !!search.grafik ||
    !!search.tedarik ||
    !!search.oncelik ||
    !!search.terminBas ||
    !!search.terminBit;

  const groups = useMemo(() => {
    if (grouping === "yok") return [{ key: "", label: "", rows }];
    const map = new Map<string, OrderRow[]>();
    for (const r of rows) {
      const key =
        grouping === "grafik" ? GRAPHIC_STATUS_LABELS[r.graphic_status] : (r.customers?.name ?? "—");
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return Array.from(map, ([label, groupRows]) => ({ key: label, label, rows: groupRows }));
  }, [rows, grouping]);

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
      _ordered_on: form.ordered_on,
      _due_on: form.due_on,
      _supply_status: form.supply_status,
      _priority: form.priority,
      _note: form.note,
      _critical_note: form.critical_note,
      // Aynı form gönderiminin ağ tekrarları tek sipariş oluşturur.
      _idempotency_key: createKey.current,
    });
    setSaving(false);
    if (error) return void toast.error(orderErrorText(error.message));
    createKey.current = newIdempotencyKey();
    setForm(emptyForm);
    setShowForm(false);
    toast.success("Sipariş açıldı");
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  }

  const sortButton = (key: typeof sortKey, label: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 hover:underline"
      onClick={() =>
        setSearch({ sirala: key, yon: sortKey === key && sortDir === "asc" ? "desc" : "asc" })
      }
    >
      {label}
      {sortKey === key && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );

  const th = "border-b border-border px-2 py-2 text-left align-bottom font-medium";
  const td = "border-b border-border/60 px-2 py-1.5 align-top";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Siparişler</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grafik durumu üretimi başlatmaz; üretime alma sonraki aşamada ayrı bir karardır.
          </p>
        </div>
        {canCreate && <Button onClick={() => setShowForm(true)}>Yeni sipariş</Button>}
      </div>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <CardTitle className="text-base">
            Sipariş listesi{" "}
            <span className="font-normal text-muted-foreground">
              — toplam {total} kayıt, sayfa {page}/{pageCount}
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-9 w-64"
              placeholder="İş emri, işin adı veya firma ara…"
              defaultValue={search.q ?? ""}
              onKeyDown={(e) => {
                if (e.key === "Enter") setSearch({ q: (e.target as HTMLInputElement).value });
              }}
              onBlur={(e) => setSearch({ q: e.target.value })}
            />
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={search.firma ?? ""}
              onChange={(e) => setSearch({ firma: e.target.value || undefined })}
            >
              <option value="">Tüm firmalar</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={search.grafik ?? ""}
              onChange={(e) => setSearch({ grafik: e.target.value || undefined })}
            >
              <option value="">Tüm grafik durumları</option>
              {GRAPHIC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {GRAPHIC_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={search.tedarik ?? ""}
              onChange={(e) => setSearch({ tedarik: e.target.value || undefined })}
            >
              <option value="">Tüm silindir/klişe durumları</option>
              {SUPPLY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SUPPLY_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={search.oncelik ?? ""}
              onChange={(e) => setSearch({ oncelik: e.target.value || undefined })}
            >
              <option value="">Tüm öncelikler</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-sm text-muted-foreground">
              Termin
              <Input
                type="date"
                className="h-9 w-36"
                value={search.terminBas ?? ""}
                onChange={(e) => setSearch({ terminBas: e.target.value || undefined })}
              />
              –
              <Input
                type="date"
                className="h-9 w-36"
                value={search.terminBit ?? ""}
                onChange={(e) => setSearch({ terminBit: e.target.value || undefined })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={!!search.iptal}
                onChange={(e) => setSearch({ iptal: e.target.checked || undefined })}
              />
              İptal edilenleri göster
            </label>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={grouping}
              onChange={(e) => setSearch({ grup: e.target.value as typeof grouping }, false)}
            >
              <option value="yok">Gruplama yok</option>
              <option value="grafik">Grafik durumuna göre grupla</option>
              <option value="firma">Firmaya göre grupla</option>
            </select>
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  navigate({ search: { grup: grouping, sirala: sortKey, yon: sortDir } })
                }
              >
                Filtreleri temizle
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {ordersQuery.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Yükleniyor…</p>
          ) : ordersQuery.isError ? (
            <div className="space-y-2 p-4 text-sm">
              <p className="font-medium text-destructive">Liste getirilemedi.</p>
              <p className="text-muted-foreground">
                {orderErrorText((ordersQuery.error as Error).message)}
              </p>
              <Button size="sm" variant="outline" onClick={() => ordersQuery.refetch()}>
                Yeniden dene
              </Button>
            </div>
          ) : total === 0 && filtersActive ? (
            <p className="p-4 text-sm text-muted-foreground">
              Bu filtrelere uyan sipariş yok. Filtreleri gevşetip yeniden deneyin.
            </p>
          ) : total === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Henüz sipariş yok.{canCreate ? " Sağ üstten yeni sipariş açabilirsiniz." : ""}
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[1500px] border-collapse text-xs">
                <thead className="sticky top-0 z-20 bg-card">
                  <tr className="text-muted-foreground">
                    <th
                      className={`${th} sticky left-0 z-30 bg-card`}
                      style={{ width: 120, minWidth: 120 }}
                    >
                      {sortButton("work_order_no", "İş Emri No")}
                    </th>
                    <th
                      className={`${th} sticky z-30 bg-card`}
                      style={{ left: 120, width: 180, minWidth: 180 }}
                    >
                      Firma
                    </th>
                    <th className={`${th} min-w-[320px]`}>{sortButton("name", "İşin Adı")}</th>
                    <th className={`${th} w-20 text-right`}>
                      {sortButton("quantity", "Silindir")}
                    </th>
                    <th className={`${th} w-20 text-right`}>Çevre (mm)</th>
                    <th className={`${th} w-20 text-right`}>Boy (mm)</th>
                    <th className={`${th} w-48`}>Silindir/Klişe Durumu</th>
                    <th className={`${th} w-44`}>Grafik Durumu</th>
                    <th className={`${th} w-28`}>{sortButton("due_on", "Termin")}</th>
                    <th className={`${th} w-20`}>Öncelik</th>
                    <th className={`${th} w-24`}>Güncel PDF</th>
                    <th className={`${th} min-w-[200px]`}>Not / Kritik Not</th>
                    <th className={`${th} w-24`}>İşlemler</th>
                  </tr>
                </thead>
                {groups.map((g) => {
                  const collapsed = !!closedGroups[g.key];
                  return (
                    <tbody key={g.key || "tek"}>
                      {grouping !== "yok" && (
                        <tr className="bg-muted/50">
                          <td className={`${td} sticky left-0 z-10 bg-muted/50`} colSpan={13}>
                            <button
                              type="button"
                              className="font-medium hover:underline"
                              onClick={() =>
                                setClosedGroups((p) => ({ ...p, [g.key]: !p[g.key] }))
                              }
                            >
                              {collapsed ? "▸" : "▾"} {g.label} — bu sayfada {g.rows.length} kayıt
                            </button>
                          </td>
                        </tr>
                      )}
                      {!collapsed &&
                        g.rows.map((o) => (
                          <tr key={o.id} className="hover:bg-accent/40">
                            <td
                              className={`${td} sticky left-0 z-10 bg-card font-mono`}
                              style={{ width: 120, minWidth: 120 }}
                            >
                              {o.work_order_no}
                            </td>
                            <td
                              className={`${td} sticky z-10 bg-card`}
                              style={{ left: 120, width: 180, minWidth: 180 }}
                            >
                              {o.customers?.name ?? "—"}
                            </td>
                            <td className={`${td} font-medium`}>{o.name}</td>
                            <td className={`${td} text-right tabular-nums`}>{o.quantity}</td>
                            <td className={`${td} text-right tabular-nums`}>
                              {o.nominal_circumference_mm}
                            </td>
                            <td className={`${td} text-right tabular-nums`}>
                              {o.target_length_mm}
                            </td>
                            <td className={td}>
                              <Badge variant="outline" className="whitespace-normal text-[11px]">
                                {SUPPLY_STATUS_LABELS[o.supply_status]}
                              </Badge>
                            </td>
                            <td className={td}>
                              <Badge variant="secondary" className="whitespace-normal text-[11px]">
                                {GRAPHIC_STATUS_LABELS[o.graphic_status]}
                              </Badge>
                            </td>
                            <td className={`${td} whitespace-nowrap`}>
                              {o.due_on}
                              {isLate(o.due_on, o.closure_status) && (
                                <span className="ml-1 text-destructive">gecikmiş</span>
                              )}
                            </td>
                            <td className={td}>
                              {o.closure_status === "iptal" ? (
                                <Badge variant="destructive">İptal</Badge>
                              ) : o.priority === "normal" ? (
                                PRIORITY_LABELS[o.priority]
                              ) : (
                                <Badge variant="outline">{PRIORITY_LABELS[o.priority]}</Badge>
                              )}
                            </td>
                            <td className={`${td} tabular-nums`}>
                              {revisions?.get(o.id) ? `Rev ${revisions.get(o.id)}` : "—"}
                            </td>
                            <td className={`${td} text-muted-foreground`}>
                              {o.critical_note && (
                                <span className="font-medium text-destructive">
                                  {o.critical_note}
                                </span>
                              )}
                              {o.critical_note && o.note && " · "}
                              {o.note}
                              {!o.note && !o.critical_note && "—"}
                            </td>
                            <td className={td}>
                              <Link
                                to="/siparis/$orderId"
                                params={{ orderId: o.id }}
                                className="text-primary hover:underline"
                              >
                                Detay
                              </Link>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} / {total}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setSearch({ sayfa: page - 1 }, false)}
            >
              Önceki
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pageCount}
              onClick={() => setSearch({ sayfa: page + 1 }, false)}
            >
              Sonraki
            </Button>
          </div>
        </div>
      )}

      <Sheet open={showForm && canCreate} onOpenChange={setShowForm}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Yeni sipariş</SheetTitle>
            <SheetDescription>
              İş emri numarası aynı müşteride tekrar edemez. Termin ve silindir adedi zorunludur.
            </SheetDescription>
          </SheetHeader>
          <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <div className="space-y-1 sm:col-span-2">
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
              <Label htmlFor="o-ordered">Sipariş tarihi</Label>
              <Input
                id="o-ordered"
                type="date"
                required
                value={form.ordered_on}
                onChange={(e) => setForm({ ...form, ordered_on: e.target.value })}
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
                onChange={(e) => setForm({ ...form, nominal_circumference_mm: e.target.value })}
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
                onChange={(e) => setForm({ ...form, priority: e.target.value as OrderPriority })}
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
        </SheetContent>
      </Sheet>
    </div>
  );
}
