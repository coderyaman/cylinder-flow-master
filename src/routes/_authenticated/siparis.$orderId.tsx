import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  finalizeGraphicUpload,
  graphicAccessLink,
  startGraphicUpload,
} from "@/lib/graphics.functions";
import {
  GRAPHIC_STATUSES,
  GRAPHIC_STATUS_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  SUPPLY_STATUSES,
  SUPPLY_STATUS_LABELS,
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

export const Route = createFileRoute("/_authenticated/siparis/$orderId")({
  head: () => ({
    meta: [
      { title: "Sipariş Kartı — Rotagravür MES" },
      {
        name: "description",
        content: "Sipariş bilgileri, grafik durumu ve PDF revizyon geçmişi.",
      },
      { property: "og:title", content: "Sipariş Kartı — Rotagravür MES" },
      { property: "og:description", content: "Sipariş kartı ve grafik dosya yönetimi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrderDetail,
});

const MAX_BYTES = 52428800;

function OrderDetail() {
  const { orderId } = Route.useParams();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("orders.create");
  const canGraphics = hasPermission("orders.edit_graphics");
  const canDownload = hasPermission("orders.read_graphic_file");
  const canCancel = hasPermission("orders.cancel");
  const queryClient = useQueryClient();

  const orderQuery = useQuery({
    queryKey: ["order", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*, customers(name, is_active)")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const assetsQuery = useQuery({
    queryKey: ["graphic-assets", orderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("graphic_assets")
        .select("id, revision_no, filename, byte_size, uploaded_by, uploaded_at, is_current")
        .eq("order_id", orderId)
        .order("revision_no", { ascending: false });
      if (error) throw error;

      const ids = Array.from(new Set((data ?? []).map((a) => a.uploaded_by).filter(Boolean)));
      const names = new Map<string, string>();
      if (ids.length > 0) {
        const { data: people } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids as string[]);
        for (const p of people ?? []) names.set(p.id, p.full_name);
      }
      return (data ?? []).map((a) => ({
        ...a,
        uploader: (a.uploaded_by && names.get(a.uploaded_by)) || "Bilinmiyor",
      }));
    },
  });

  const order = orderQuery.data;
  const [form, setForm] = useState<null | {
    work_order_no: string;
    name: string;
    quantity: string;
    nominal_circumference_mm: string;
    target_length_mm: string;
    due_on: string;
    supply_status: SupplyStatus;
    priority: OrderPriority;
    note: string;
    critical_note: string;
  }>(null);
  const [busy, setBusy] = useState(false);
  const [pendingPdf, setPendingPdf] = useState<File | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const startUpload = useServerFn(startGraphicUpload);
  const finalizeUpload = useServerFn(finalizeGraphicUpload);
  const accessLink = useServerFn(graphicAccessLink);
  const currentRevision = (assetsQuery.data ?? []).reduce(
    (max, a) => Math.max(max, a.revision_no),
    0,
  );
  // Kullanıcının açtığı sürüm: arka plan yenilemesi taslağı ezmez.
  const [baseVersion, setBaseVersion] = useState<number | null>(null);

  // Aynı mantıksal işlemin ağ tekrarlarında anahtar sabit kalır; başarıdan sonra yenilenir.
  const keys = useRef<Record<string, string>>({});
  const keyFor = (op: string) => (keys.current[op] ??= newIdempotencyKey());
  const clearKey = (op: string) => {
    delete keys.current[op];
  };

  useEffect(() => {
    if (!order) return;
    setForm((prev) =>
      prev
        ? prev
        : {
            work_order_no: order.work_order_no,
            name: order.name,
            quantity: String(order.quantity),
            nominal_circumference_mm: String(order.nominal_circumference_mm),
            target_length_mm: String(order.target_length_mm),
            due_on: order.due_on,
            supply_status: order.supply_status,
            priority: order.priority,
            note: order.note ?? "",
            critical_note: order.critical_note ?? "",
          },
    );
    setBaseVersion((prev) => prev ?? order.row_version);
  }, [order?.id, order?.row_version]);

  function loadCurrentIntoForm() {
    if (!order) return;
    setForm({
      work_order_no: order.work_order_no,
      name: order.name,
      quantity: String(order.quantity),
      nominal_circumference_mm: String(order.nominal_circumference_mm),
      target_length_mm: String(order.target_length_mm),
      due_on: order.due_on,
      supply_status: order.supply_status,
      priority: order.priority,
      note: order.note ?? "",
      critical_note: order.critical_note ?? "",
    });
    setBaseVersion(order.row_version);
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    queryClient.invalidateQueries({ queryKey: ["graphic-assets", orderId] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };

  if (orderQuery.isLoading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (!order || !form)
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Sipariş bulunamadı</CardTitle>
          <CardDescription>Kayıt silinmiş olabilir ya da görme yetkiniz yok.</CardDescription>
        </CardHeader>
      </Card>
    );

  const cancelled = order.closure_status === "iptal";
  const stale = baseVersion !== null && order.row_version !== baseVersion;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!order || !form) return;
    setBusy(true);
    const { error } = await supabase.rpc("update_order", {
      _order_id: order.id,
      _row_version: baseVersion ?? order.row_version,
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
      _idempotency_key: keyFor("update"),
    });
    setBusy(false);
    if (error) return void toast.error(orderErrorText(error.message));
    clearKey("update");
    setBaseVersion(null);
    setForm(null);
    toast.success("Sipariş güncellendi");
    refresh();
  }

  async function changeGraphicStatus(status: GraphicStatus) {
    if (!order) return;
    const { error } = await supabase.rpc("set_graphic_status", {
      _order_id: order.id,
      _row_version: baseVersion ?? order.row_version,
      _status: status,
      _idempotency_key: keyFor("status:" + status),
    });
    if (error) return void toast.error(orderErrorText(error.message));
    clearKey("status:" + status);
    setBaseVersion(null);
    toast.success("Grafik durumu güncellendi");
    refresh();
  }

  async function cancelOrder() {
    if (!order) return;
    if (!cancelReason.trim()) return void toast.error("İptal gerekçesi zorunludur.");
    const { error } = await supabase.rpc("cancel_order", {
      _order_id: order.id,
      _row_version: baseVersion ?? order.row_version,
      _reason: cancelReason.trim(),
      _idempotency_key: keyFor("cancel"),
    });
    if (error) return void toast.error(orderErrorText(error.message));
    clearKey("cancel");
    setCancelReason("");
    toast.success("Sipariş iptal edildi");
    refresh();
  }

  async function uploadPdf(file: File) {
    if (!order) return;
    if (file.type !== "application/pdf") return void toast.error("Yalnızca PDF yüklenebilir.");
    if (file.size === 0 || file.size > MAX_BYTES)
      return void toast.error("Dosya boş olamaz ve 50 MB'ı aşamaz.");

    setBusy(true);
    try {
      // 1) Sunucu yetkiyi doğrular ve yalnızca bu yüklemeye ait hedefi üretir.
      const target = await startUpload({
        data: { orderId: order.id, expectedRevision: currentRevision },
      });
      // 2) Dosya yalnızca o hedefe gönderilir.
      const up = await supabase.storage
        .from("grafik-pdf")
        .uploadToSignedUrl(target.path, target.token, file, {
          contentType: "application/pdf",
        });
      if (up.error) throw new Error(up.error.message);
      // 3) Sunucu gerçek dosyayı doğrular; kayıt, güncel dosya ve denetim aynı işlemde oluşur.
      const res = await finalizeUpload({
        data: { sessionId: target.sessionId, filename: file.name },
      });
      setPendingPdf(null);
      toast.success(`PDF yüklendi (revizyon ${res.revision_no})`);
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("REVIZYON_CAKISMASI")) {
        setPendingPdf(file);
        toast.error("Siz yüklerken yeni bir revizyon geldi. Dosyanız duruyor; listeyi görüp yeniden gönderebilirsiniz.");
      } else {
        toast.error(orderErrorText(message));
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function download(assetId: string) {
    try {
      const res = await accessLink({ data: { assetId } });
      window.open(res.url, "_blank", "noopener");
    } catch (err) {
      toast.error(orderErrorText(err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/siparisler" className="text-xs text-muted-foreground hover:underline">
            ← Sipariş listesi
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {order.name}{" "}
            <span className="font-mono text-base text-muted-foreground">
              #{order.work_order_no}
            </span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {order.customers?.name} · sipariş {order.ordered_on} · termin {order.due_on}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cancelled && <Badge variant="destructive">İptal edildi</Badge>}
          <Badge variant="secondary">{GRAPHIC_STATUS_LABELS[order.graphic_status]}</Badge>
          <Badge variant="outline">{SUPPLY_STATUS_LABELS[order.supply_status]}</Badge>
        </div>
      </div>

      {cancelled && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">İptal gerekçesi</CardTitle>
            <CardDescription>{order.cancel_reason}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {stale && (
        <Card className="border-amber-500/60">
          <CardHeader>
            <CardTitle className="text-base">Bu kayıt siz düzenlerken değişti</CardTitle>
            <CardDescription>
              Yazdıklarınız korunuyor. Aşağıda güncel kayıttaki değerler var; karşılaştırıp
              kendi taslağınızı kaydedebilir ya da güncel hâli forma yükleyebilirsiniz.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Güncel: {order.name} · #{order.work_order_no} · {order.quantity} silindir ·
              termin {order.due_on} · {GRAPHIC_STATUS_LABELS[order.graphic_status]}
            </p>
            <Button size="sm" variant="outline" onClick={loadCurrentIntoForm}>
              Güncel kaydı forma yükle (taslağınız silinir)
            </Button>
          </CardContent>
        </Card>
      )}


      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sipariş bilgileri</CardTitle>
          <CardDescription>
            {canEdit && !cancelled
              ? "Kaydetme sırasında kayıt başkası tarafından değiştirilmişse işlem reddedilir."
              : "Bu sipariş sizin için salt okunurdur."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
            <fieldset disabled={!canEdit || cancelled || busy} className="contents">
              <div className="space-y-1">
                <Label htmlFor="d-wo">İş emri no</Label>
                <Input
                  id="d-wo"
                  value={form.work_order_no}
                  onChange={(e) => setForm({ ...form, work_order_no: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="d-name">İşin adı</Label>
                <Input
                  id="d-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="d-qty">Silindir adedi</Label>
                <Input
                  id="d-qty"
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="d-due">Termin</Label>
                <Input
                  id="d-due"
                  type="date"
                  value={form.due_on}
                  onChange={(e) => setForm({ ...form, due_on: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="d-circ">Nominal çevre (mm)</Label>
                <Input
                  id="d-circ"
                  type="number"
                  step="0.01"
                  value={form.nominal_circumference_mm}
                  onChange={(e) =>
                    setForm({ ...form, nominal_circumference_mm: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="d-len">Boy (mm)</Label>
                <Input
                  id="d-len"
                  type="number"
                  step="0.01"
                  value={form.target_length_mm}
                  onChange={(e) => setForm({ ...form, target_length_mm: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="d-supply">Silindir / klişe durumu</Label>
                <select
                  id="d-supply"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
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
                <Label htmlFor="d-prio">Öncelik</Label>
                <select
                  id="d-prio"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
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
                <Label htmlFor="d-note">Not</Label>
                <Textarea
                  id="d-note"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="d-crit">Kritik not</Label>
                <Textarea
                  id="d-crit"
                  value={form.critical_note}
                  onChange={(e) => setForm({ ...form, critical_note: e.target.value })}
                />
              </div>
              {canEdit && !cancelled && (
                <Button type="submit" className="sm:col-span-2" disabled={busy}>
                  {busy ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
                </Button>
              )}
            </fieldset>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grafik durumu</CardTitle>
          <CardDescription>
            "Grafik Hazır" bir üretim tetikleyicisi değildir; üretime alma ayrı bir karardır.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {GRAPHIC_STATUSES.map((s) => (
            <Button
              key={s}
              size="sm"
              variant={order.graphic_status === s ? "default" : "outline"}
              disabled={!canGraphics || cancelled || order.graphic_status === s}
              onClick={() => changeGraphicStatus(s)}
            >
              {GRAPHIC_STATUS_LABELS[s]}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grafik PDF revizyonları</CardTitle>
          <CardDescription>
            Yeni yükleme eski revizyonu silmez; yalnızca güncel dosya değişir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2">
            {(assetsQuery.data ?? []).map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">
                    Rev {a.revision_no} · {a.filename}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(Number(a.byte_size) / 1048576).toFixed(2)} MB ·{" "}
                    {new Date(a.uploaded_at).toLocaleString("tr-TR")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {a.is_current && <Badge>Güncel</Badge>}
                  {canDownload && (
                    <Button size="sm" variant="outline" onClick={() => download(a.id)}>
                      İndir
                    </Button>
                  )}
                </div>
              </li>
            ))}
            {(assetsQuery.data ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">Henüz dosya yüklenmedi.</li>
            )}
          </ul>

          {canGraphics && !cancelled && (
            <div className="space-y-1 border-t border-border pt-4">
              <Label htmlFor="d-pdf">Yeni PDF yükle (en fazla 50 MB)</Label>
              <Input
                id="d-pdf"
                type="file"
                accept="application/pdf"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) uploadPdf(f);
                }}
              />
            </div>
          )}
          {!canDownload && (
            <p className="text-xs text-muted-foreground">
              Dosyayı indirme yetkiniz yok; yalnızca revizyon geçmişini görüyorsunuz.
            </p>
          )}
        </CardContent>
      </Card>

      {canCancel && !cancelled && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Siparişi iptal et</CardTitle>
            <CardDescription>
              Sipariş silinmez; gerekçesiyle birlikte iptal edilir ve salt okunur olur.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="İptal gerekçesi (zorunlu)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <Button variant="destructive" onClick={cancelOrder}>
              İptal et
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
