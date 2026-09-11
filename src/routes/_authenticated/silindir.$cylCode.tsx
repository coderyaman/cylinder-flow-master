import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey, orderErrorText } from "@/lib/orders";
import {
  SHAFT_LABELS,
  SHAFT_TYPES,
  SURFACE_LABELS,
  SURFACE_STATES,
  USABILITIES,
  USABILITY_LABELS,
  formatMm,
  parseTrNumber,
  type ShaftType,
  type SurfaceState,
  type Usability,
} from "@/lib/cylinders";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/silindir/$cylCode")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.cylCode} — Silindir Kartı — Rotagravür MES` },
      {
        name: "description",
        content: "Silindir kabul bilgileri, ölçüm geçmişi, notlar ve etiket yazdırma.",
      },
      { property: "og:title", content: `${params.cylCode} — Silindir Kartı` },
      { property: "og:description", content: "Kabul bilgileri ve ölçüm geçmişi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CylinderCard,
});

type Receipt = {
  id: string;
  cyl_code: string;
  customer_id: string;
  waybill_no: string | null;
  received_on: string;
  measured_circumference_mm: number;
  measured_diameter_mm: number;
  measured_length_mm: number;
  shaft_type: ShaftType;
  surface_state: SurfaceState;
  usability: Usability;
  note: string | null;
  status: "kabul" | "iptal";
  cancel_reason: string | null;
  label_print_count: number;
  row_version: number;
  created_by: string | null;
  created_at: string;
  customers: { name: string } | null;
};

function CylinderCard() {
  const { cylCode } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userId, hasPermission } = useAuth();
  const canReceive = hasPermission("inventory.receive");
  const canCorrect = hasPermission("inventory.correct_unassigned");

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [form, setForm] = useState<null | {
    circumference: string;
    diameter: string;
    length: string;
    shaft_type: ShaftType;
    surface_state: SurfaceState;
    usability: Usability;
    waybill_no: string;
    note: string;
    reason: string;
  }>(null);
  const editKey = useRef<string>(newIdempotencyKey());
  const cancelKey = useRef<string>(newIdempotencyKey());

  const receiptQuery = useQuery({
    queryKey: ["cylinder", cylCode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cylinder_receipts")
        .select("*, customers(name)")
        .eq("cyl_code", cylCode)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as Receipt | null;
    },
  });

  const receipt = receiptQuery.data ?? null;

  const measurementsQuery = useQuery({
    queryKey: ["cylinder-measurements", receipt?.id],
    enabled: !!receipt?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cylinder_measurements")
        .select("id, circumference_mm, diameter_mm, length_mm, source, note, measured_at")
        .eq("receipt_id", receipt!.id)
        .order("measured_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const ownRecord = !!receipt && receipt.created_by === userId;
  const canEdit =
    !!receipt && receipt.status === "kabul" && canCorrect && (ownRecord || hasPermission("team.manage"));

  function startEdit() {
    if (!receipt) return;
    setForm({
      circumference: String(receipt.measured_circumference_mm).replace(".", ","),
      diameter: String(receipt.measured_diameter_mm).replace(".", ","),
      length: String(receipt.measured_length_mm).replace(".", ","),
      shaft_type: receipt.shaft_type,
      surface_state: receipt.surface_state,
      usability: receipt.usability,
      waybill_no: receipt.waybill_no ?? "",
      note: receipt.note ?? "",
      reason: "",
    });
    editKey.current = newIdempotencyKey();
    setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!receipt || !form) return;
    const circ = parseTrNumber(form.circumference);
    const dia = parseTrNumber(form.diameter);
    const len = parseTrNumber(form.length);
    if (!circ || !dia || !len)
      return void toast.error("Ölçülen çevre, çap ve boy pozitif sayı olmalıdır.");
    if (!form.reason.trim()) return void toast.error("Düzeltme gerekçesi zorunludur.");

    setSaving(true);
    const { error } = await supabase.rpc("update_cylinder_receipt", {
      _receipt_id: receipt.id,
      _row_version: receipt.row_version,
      _measured_circumference_mm: circ,
      _measured_diameter_mm: dia,
      _measured_length_mm: len,
      _shaft_type: form.shaft_type,
      _surface_state: form.surface_state,
      _usability: form.usability,
      ...(form.waybill_no.trim() ? { _waybill_no: form.waybill_no.trim() } : {}),
      ...(form.note.trim() ? { _note: form.note.trim() } : {}),
      _reason: form.reason.trim(),
      _idempotency_key: editKey.current,
    });
    setSaving(false);
    if (error) return void toast.error(orderErrorText(error.message));
    setEditing(false);
    queryClient.invalidateQueries({ queryKey: ["cylinder", cylCode] });
    queryClient.invalidateQueries({ queryKey: ["cylinder-measurements", receipt.id] });
    queryClient.invalidateQueries({ queryKey: ["cylinders"] });
    toast.success("Kabul kaydı düzeltildi.");
  }

  async function cancelReceipt() {
    if (!receipt) return;
    if (!cancelReason.trim()) return void toast.error("İptal gerekçesi zorunludur.");
    const { error } = await supabase.rpc("cancel_cylinder_receipt", {
      _receipt_id: receipt.id,
      _row_version: receipt.row_version,
      _reason: cancelReason.trim(),
      _idempotency_key: cancelKey.current,
    });
    if (error) return void toast.error(orderErrorText(error.message));
    setCancelReason("");
    cancelKey.current = newIdempotencyKey();
    queryClient.invalidateQueries({ queryKey: ["cylinder", cylCode] });
    queryClient.invalidateQueries({ queryKey: ["cylinders"] });
    toast.success("Kayıt iptal edildi. Kayıt silinmez, geçmişte kalır.");
  }

  if (receiptQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  }
  if (receiptQuery.isError) {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium text-destructive">Silindir kartı getirilemedi.</p>
        <p className="text-muted-foreground">
          {orderErrorText((receiptQuery.error as Error).message)}
        </p>
      </div>
    );
  }
  if (!receipt) {
    return (
      <div className="space-y-3 text-sm">
        <p className="font-medium text-foreground">{cylCode} kodlu silindir kaydı bulunamadı.</p>
        <p className="text-muted-foreground">
          Kod yanlış okunmuş olabilir ya da bu kaydı görme yetkiniz yok.
        </p>
        <Button variant="outline" onClick={() => navigate({ to: "/depo" })}>
          Depo listesine dön
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/depo" className="text-sm text-muted-foreground hover:underline">
            ← Depo listesi
          </Link>
          <h1 className="mt-1 font-mono text-2xl font-bold tracking-tight text-foreground">
            {receipt.cyl_code}
          </h1>
          <p className="text-sm text-muted-foreground">
            {receipt.customers?.name ?? "—"} · Kabul{" "}
            {new Date(receipt.received_on).toLocaleDateString("tr-TR")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {receipt.status === "iptal" && <Badge variant="destructive">İptal edildi</Badge>}
          {canEdit && !editing && (
            <Button variant="outline" onClick={startEdit}>
              Kaydı düzelt
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Kabul bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <Field label="Firma" value={receipt.customers?.name ?? "—"} />
            <Field label="İrsaliye no" value={receipt.waybill_no ?? "—"} />
            <Field
              label="Kabul tarihi"
              value={new Date(receipt.received_on).toLocaleDateString("tr-TR")}
            />
            <Field label="Ölçülen çevre" value={`${formatMm(receipt.measured_circumference_mm)} mm`} />
            <Field label="Ölçülen çap" value={`${formatMm(receipt.measured_diameter_mm)} mm`} />
            <Field label="Ölçülen boy" value={`${formatMm(receipt.measured_length_mm)} mm`} />
            <Field label="Mil tipi" value={SHAFT_LABELS[receipt.shaft_type]} />
            <Field label="Yüzey durumu" value={SURFACE_LABELS[receipt.surface_state]} />
            <Field label="Kullanılabilirlik" value={USABILITY_LABELS[receipt.usability]} />
            <div className="sm:col-span-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Not</p>
              <p className="whitespace-pre-wrap">{receipt.note ?? "—"}</p>
            </div>
            {receipt.cancel_reason && (
              <div className="sm:col-span-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  İptal gerekçesi
                </p>
                <p className="whitespace-pre-wrap text-destructive">{receipt.cancel_reason}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <LabelCard receipt={receipt} canPrint={canReceive} />
      </div>

      {editing && form && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Kaydı düzelt</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={saveEdit}>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="e-cevre">Ölçülen çevre (mm)</Label>
                  <Input
                    id="e-cevre"
                    inputMode="decimal"
                    value={form.circumference}
                    onChange={(e) => setForm({ ...form, circumference: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e-cap">Ölçülen çap (mm)</Label>
                  <Input
                    id="e-cap"
                    inputMode="decimal"
                    value={form.diameter}
                    onChange={(e) => setForm({ ...form, diameter: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e-boy">Ölçülen boy (mm)</Label>
                  <Input
                    id="e-boy"
                    inputMode="decimal"
                    value={form.length}
                    onChange={(e) => setForm({ ...form, length: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="e-mil">Mil tipi</Label>
                  <select
                    id="e-mil"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={form.shaft_type}
                    onChange={(e) => setForm({ ...form, shaft_type: e.target.value as ShaftType })}
                  >
                    {SHAFT_TYPES.map((s) => (
                      <option key={s} value={s}>
                        {SHAFT_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e-yuzey">Yüzey durumu</Label>
                  <select
                    id="e-yuzey"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={form.surface_state}
                    onChange={(e) =>
                      setForm({ ...form, surface_state: e.target.value as SurfaceState })
                    }
                  >
                    {SURFACE_STATES.map((s) => (
                      <option key={s} value={s}>
                        {SURFACE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e-kullanim">Kullanılabilirlik</Label>
                  <select
                    id="e-kullanim"
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={form.usability}
                    onChange={(e) => setForm({ ...form, usability: e.target.value as Usability })}
                  >
                    {USABILITIES.map((u) => (
                      <option key={u} value={u}>
                        {USABILITY_LABELS[u]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="e-irsaliye">İrsaliye no</Label>
                  <Input
                    id="e-irsaliye"
                    value={form.waybill_no}
                    onChange={(e) => setForm({ ...form, waybill_no: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="e-gerekce">Düzeltme gerekçesi *</Label>
                  <Input
                    id="e-gerekce"
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-not">Not</Label>
                <Textarea
                  id="e-not"
                  rows={3}
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  Vazgeç
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Kaydediliyor…" : "Düzeltmeyi kaydet"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Ölçüm geçmişi</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {measurementsQuery.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Yükleniyor…</p>
          ) : (measurementsQuery.data ?? []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Ölçüm kaydı yok.</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="border-b border-border px-3 py-2 font-medium">Tarih</th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">
                    Çevre (mm)
                  </th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">
                    Çap (mm)
                  </th>
                  <th className="border-b border-border px-3 py-2 text-right font-medium">
                    Boy (mm)
                  </th>
                  <th className="border-b border-border px-3 py-2 font-medium">Kaynak</th>
                  <th className="border-b border-border px-3 py-2 font-medium">Not</th>
                </tr>
              </thead>
              <tbody>
                {(measurementsQuery.data ?? []).map((m) => (
                  <tr key={m.id}>
                    <td className="border-b border-border/60 px-3 py-2 whitespace-nowrap">
                      {new Date(m.measured_at).toLocaleString("tr-TR")}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 text-right tabular-nums">
                      {formatMm(m.circumference_mm)}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 text-right tabular-nums">
                      {formatMm(m.diameter_mm)}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2 text-right tabular-nums">
                      {formatMm(m.length_mm)}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2">
                      {m.source === "kabul" ? "Kabul ölçümü" : "Düzeltme"}
                    </td>
                    <td className="border-b border-border/60 px-3 py-2">{m.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Kaydı iptal et</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1 space-y-1.5">
              <Label htmlFor="iptal">İptal gerekçesi</Label>
              <Input
                id="iptal"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ör. yanlış firma adına kaydedildi"
              />
            </div>
            <Button variant="destructive" onClick={cancelReceipt}>
              İptal et
            </Button>
            <p className="w-full text-xs text-muted-foreground">
              Hatalı kayıt silinmez; gerekçesiyle iptal edilir ve geçmişte görünür.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}

function LabelCard({ receipt, canPrint }: { receipt: Receipt; canPrint: boolean }) {
  const [qr, setQr] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { toDataURL } = await import("qrcode");
      const origin = typeof window === "undefined" ? "" : window.location.origin;
      const url = await toDataURL(`${origin}/silindir/${receipt.cyl_code}`, {
        margin: 1,
        width: 320,
      });
      if (!cancelled) setQr(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [receipt.cyl_code]);

  async function printLabel() {
    const { error } = await supabase.rpc("record_label_print", { _receipt_id: receipt.id });
    if (error) return void toast.error(orderErrorText(error.message));
    queryClient.invalidateQueries({ queryKey: ["cylinder", receipt.cyl_code] });
    window.print();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Etiket</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="rounded-md border border-border p-3 text-center">
          {qr ? (
            <img src={qr} alt={`${receipt.cyl_code} QR kodu`} className="mx-auto h-40 w-40" />
          ) : (
            <div className="mx-auto h-40 w-40 animate-pulse rounded bg-muted" />
          )}
          <p className="mt-2 font-mono text-lg font-bold">{receipt.cyl_code}</p>
          <p className="text-xs text-muted-foreground">{receipt.customers?.name ?? "—"}</p>
          <p className="text-xs text-muted-foreground">
            Ø {formatMm(receipt.measured_diameter_mm)} · Boy{" "}
            {formatMm(receipt.measured_length_mm)} mm
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Etiketi yeniden bastırmak yeni silindir kaydı oluşturmaz; aynı kimlik korunur. Şu ana
          kadar {receipt.label_print_count} kez basıldı.
        </p>
        {canPrint && (
          <Button variant="outline" className="w-full" onClick={printLabel}>
            Etiketi yazdır
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
