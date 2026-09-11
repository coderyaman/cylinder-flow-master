import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

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
  diameterFromCircumference,
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
  mil: z.string().optional(),
  yuzey: z.string().optional(),
  kullanim: z.string().optional(),
  iptal: z.boolean().optional(),
  sirala: z.enum(["received_on", "cyl_code", "measured_circumference_mm"]).optional(),
  yon: z.enum(["asc", "desc"]).optional(),
  sayfa: z.number().int().min(1).optional(),
});

export const Route = createFileRoute("/_authenticated/depo")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Depo Kabulü — Rotagravür MES" },
      {
        name: "description",
        content: "Müşteri silindirlerinin fabrika kabulü, ölçüleri ve CYL kimlikleri.",
      },
      { property: "og:title", content: "Depo Kabulü — Rotagravür MES" },
      { property: "og:description", content: "Silindir kabul listesi ve yeni kabul kaydı." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WarehousePage,
});

const emptyForm = {
  customer_id: "",
  waybill_no: "",
  received_on: new Date().toISOString().slice(0, 10),
  circumference: "",
  diameter: "",
  length: "",
  shaft_type: "konik" as ShaftType,
  surface_state: "temiz" as SurfaceState,
  usability: "kullanilabilir" as Usability,
  note: "",
};

type Row = {
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
  status: "kabul" | "iptal";
  customers: { name: string } | null;
};

function WarehousePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { hasPermission } = useAuth();
  const canReceive = hasPermission("inventory.receive");
  const queryClient = useQueryClient();

  const page = search.sayfa ?? 1;
  const sortKey = search.sirala ?? "received_on";
  const sortDir = search.yon ?? "desc";

  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [codeInput, setCodeInput] = useState("");
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

  const listQuery = useQuery({
    queryKey: ["cylinders", search],
    queryFn: async () => {
      let q = supabase
        .from("cylinder_receipts")
        .select(
          "id, cyl_code, customer_id, waybill_no, received_on, measured_circumference_mm, measured_diameter_mm, measured_length_mm, shaft_type, surface_state, usability, status, customers(name)",
          { count: "exact" },
        );
      if (!search.iptal) q = q.eq("status", "kabul");
      if (search.firma) q = q.eq("customer_id", search.firma);
      if (search.mil) q = q.eq("shaft_type", search.mil as ShaftType);
      if (search.yuzey) q = q.eq("surface_state", search.yuzey as SurfaceState);
      if (search.kullanim) q = q.eq("usability", search.kullanim as Usability);
      if (search.q?.trim()) {
        const term = `%${search.q.trim()}%`;
        q = q.or(`cyl_code.ilike.${term},waybill_no.ilike.${term}`);
      }
      q = q
        .order(sortKey, { ascending: sortDir === "asc" })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as Row[], count: count ?? 0 };
    },
  });

  const total = listQuery.data?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = listQuery.data?.rows ?? [];
  const filtersActive = !!(
    search.q ||
    search.firma ||
    search.mil ||
    search.yuzey ||
    search.kullanim
  );

  function copyPrevious() {
    const last = rows[0];
    if (!last) return void toast.info("Kopyalanacak önceki kabul kaydı yok.");
    setForm((f) => ({
      ...f,
      customer_id: last.customer_id,
      waybill_no: last.waybill_no ?? "",
      shaft_type: last.shaft_type,
      surface_state: last.surface_state,
      usability: last.usability,
      circumference: "",
      diameter: "",
      length: "",
    }));
    toast.info("Ortak bilgiler kopyalandı. Ölçüleri bu silindir için yeniden ölçüp girin.");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const circ = parseTrNumber(form.circumference);
    const dia = parseTrNumber(form.diameter);
    const len = parseTrNumber(form.length);
    if (!form.customer_id) return void toast.error("Firma zorunludur.");
    if (!circ || !dia || !len)
      return void toast.error("Ölçülen çevre, çap ve boy pozitif sayı olmalıdır.");

    setSaving(true);
    const { data, error } = await supabase.rpc("receive_cylinder", {
      _customer_id: form.customer_id,
      _measured_circumference_mm: circ,
      _measured_diameter_mm: dia,
      _measured_length_mm: len,
      _shaft_type: form.shaft_type,
      _surface_state: form.surface_state,
      _usability: form.usability,
      ...(form.waybill_no.trim() ? { _waybill_no: form.waybill_no.trim() } : {}),
      _received_on: form.received_on,
      ...(form.note.trim() ? { _note: form.note.trim() } : {}),
      _idempotency_key: createKey.current,
    });
    setSaving(false);
    if (error) return void toast.error(orderErrorText(error.message));

    const result = data as unknown as { cyl_code: string };
    createKey.current = newIdempotencyKey();
    setForm({ ...emptyForm, customer_id: form.customer_id });
    setShowForm(false);
    queryClient.invalidateQueries({ queryKey: ["cylinders"] });
    toast.success(`Kabul kaydedildi: ${result.cyl_code}`);
  }

  function openCode(raw: string) {
    const code = extractCylCode(raw);
    if (!code) return void toast.error("Geçerli bir CYL kodu okunamadı.");
    navigate({ to: "/silindir/$cylCode", params: { cylCode: code } });
  }

  const th = "border-b border-border px-2 py-2 text-left align-bottom font-medium";
  const td = "border-b border-border/60 px-2 py-1.5 align-top";

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

  const previewDiameter = (() => {
    const c = parseTrNumber(form.circumference);
    return c ? formatMm(diameterFromCircumference(c)) : null;
  })();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Depo kabulü</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Her kabul, o silindirin bu fabrika ziyaretidir. Sevk edilip yeniden gelen aynı metal
            yeni kayıt ve yeni QR alır.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setScanOpen(true)}>
            QR okut / kodla bul
          </Button>
          {canReceive && <Button onClick={() => setShowForm(true)}>Yeni kabul</Button>}
        </div>
      </div>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <CardTitle className="text-base">
            Kabul listesi{" "}
            <span className="font-normal text-muted-foreground">
              — toplam {total} kayıt, sayfa {page}/{pageCount}
            </span>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-9 w-64"
              placeholder="CYL kodu veya irsaliye ara…"
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
              value={search.mil ?? ""}
              onChange={(e) => setSearch({ mil: e.target.value || undefined })}
            >
              <option value="">Tüm mil tipleri</option>
              {SHAFT_TYPES.map((s) => (
                <option key={s} value={s}>
                  {SHAFT_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={search.yuzey ?? ""}
              onChange={(e) => setSearch({ yuzey: e.target.value || undefined })}
            >
              <option value="">Tüm yüzey durumları</option>
              {SURFACE_STATES.map((s) => (
                <option key={s} value={s}>
                  {SURFACE_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={search.kullanim ?? ""}
              onChange={(e) => setSearch({ kullanim: e.target.value || undefined })}
            >
              <option value="">Tüm kullanılabilirlikler</option>
              {USABILITIES.map((u) => (
                <option key={u} value={u}>
                  {USABILITY_LABELS[u]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={!!search.iptal}
                onChange={(e) => setSearch({ iptal: e.target.checked || undefined })}
              />
              İptal edilenleri göster
            </label>
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate({ search: { sirala: sortKey, yon: sortDir } })}
              >
                Filtreleri temizle
              </Button>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Yükleniyor…</p>
          ) : listQuery.isError ? (
            <div className="space-y-2 p-4 text-sm">
              <p className="font-medium text-destructive">Liste getirilemedi.</p>
              <p className="text-muted-foreground">
                {orderErrorText((listQuery.error as Error).message)}
              </p>
              <Button size="sm" variant="outline" onClick={() => listQuery.refetch()}>
                Yeniden dene
              </Button>
            </div>
          ) : total === 0 && filtersActive ? (
            <p className="p-4 text-sm text-muted-foreground">
              Bu filtrelere uyan kabul kaydı yok.
            </p>
          ) : total === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Henüz kabul kaydı yok.{canReceive ? " Sağ üstten yeni kabul açabilirsiniz." : ""}
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-20 bg-card">
                  <tr>
                    <th
                      className={`${th} sticky left-0 z-30 bg-card`}
                      style={{ width: 140, minWidth: 140 }}
                    >
                      {sortButton("cyl_code", "CYL Kodu")}
                    </th>
                    <th
                      className={`${th} sticky z-30 bg-card`}
                      style={{ left: 140, width: 200, minWidth: 200 }}
                    >
                      Firma
                    </th>
                    <th className={`${th} text-right`}>
                      {sortButton("measured_circumference_mm", "Çevre (mm)")}
                    </th>
                    <th className={`${th} text-right`}>Çap (mm)</th>
                    <th className={`${th} text-right`}>Boy (mm)</th>
                    <th className={th}>Mil</th>
                    <th className={th}>Yüzey</th>
                    <th className={th}>Kullanılabilirlik</th>
                    <th className={th}>İrsaliye</th>
                    <th className={th}>{sortButton("received_on", "Kabul Tarihi")}</th>
                    <th className={th}>İşlemler</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-accent/40">
                      <td
                        className={`${td} sticky left-0 z-10 bg-card font-mono`}
                        style={{ width: 140, minWidth: 140 }}
                      >
                        {r.cyl_code}
                      </td>
                      <td
                        className={`${td} sticky z-10 bg-card`}
                        style={{ left: 140, width: 200, minWidth: 200 }}
                      >
                        {r.customers?.name ?? "—"}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {formatMm(r.measured_circumference_mm)}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {formatMm(r.measured_diameter_mm)}
                      </td>
                      <td className={`${td} text-right tabular-nums`}>
                        {formatMm(r.measured_length_mm)}
                      </td>
                      <td className={td}>{SHAFT_LABELS[r.shaft_type]}</td>
                      <td className={td}>{SURFACE_LABELS[r.surface_state]}</td>
                      <td className={td}>
                        <Badge
                          variant={
                            r.usability === "kullanilabilir"
                              ? "secondary"
                              : r.usability === "sartli"
                                ? "outline"
                                : "destructive"
                          }
                        >
                          {USABILITY_LABELS[r.usability]}
                        </Badge>
                      </td>
                      <td className={td}>{r.waybill_no ?? "—"}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        {new Date(r.received_on).toLocaleDateString("tr-TR")}
                        {r.status === "iptal" && (
                          <Badge variant="destructive" className="ml-2">
                            İptal
                          </Badge>
                        )}
                      </td>
                      <td className={td}>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate({
                              to: "/silindir/$cylCode",
                              params: { cylCode: r.cyl_code },
                            })
                          }
                        >
                          Kartı aç
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setSearch({ sayfa: page - 1 }, false)}
          >
            Önceki
          </Button>
          <span className="text-muted-foreground">
            {page} / {pageCount}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= pageCount}
            onClick={() => setSearch({ sayfa: page + 1 }, false)}
          >
            Sonraki
          </Button>
        </div>
      )}

      <Sheet open={showForm && canReceive} onOpenChange={setShowForm}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Yeni silindir kabulü</SheetTitle>
            <SheetDescription>
              Sipariş olmadan da kabul yapılabilir. Firma zorunlu, irsaliye numarası isteğe
              bağlıdır. Ondalık ayırıcı olarak virgül kullanabilirsiniz.
            </SheetDescription>
          </SheetHeader>
          <form className="space-y-4 px-4 pb-6" onSubmit={submit}>
            <div className="flex justify-end">
              <Button type="button" size="sm" variant="ghost" onClick={copyPrevious}>
                Önceki kaydı kopyala
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="firma">Firma *</Label>
              <select
                id="firma"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                required
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="irsaliye">İrsaliye no (isteğe bağlı)</Label>
                <Input
                  id="irsaliye"
                  value={form.waybill_no}
                  onChange={(e) => setForm({ ...form, waybill_no: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tarih">Kabul tarihi</Label>
                <Input
                  id="tarih"
                  type="date"
                  value={form.received_on}
                  onChange={(e) => setForm({ ...form, received_on: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cevre">Ölçülen çevre (mm) *</Label>
                <Input
                  id="cevre"
                  inputMode="decimal"
                  value={form.circumference}
                  onChange={(e) => setForm({ ...form, circumference: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cap">Ölçülen çap (mm) *</Label>
                <Input
                  id="cap"
                  inputMode="decimal"
                  value={form.diameter}
                  onChange={(e) => setForm({ ...form, diameter: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="boy">Ölçülen boy (mm) *</Label>
                <Input
                  id="boy"
                  inputMode="decimal"
                  value={form.length}
                  onChange={(e) => setForm({ ...form, length: e.target.value })}
                  required
                />
              </div>
            </div>
            {previewDiameter && (
              <p className="text-xs text-muted-foreground">
                Bilgi: çevreden hesaplanan çap yaklaşık {previewDiameter} mm. Bu değer
                kaydedilmez; çap alanına ölçtüğünüz değeri yazın.
              </p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="mil">Mil tipi</Label>
                <select
                  id="mil"
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
                <Label htmlFor="yuzey">Yüzey durumu</Label>
                <select
                  id="yuzey"
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
                <Label htmlFor="kullanim">Kullanılabilirlik</Label>
                <select
                  id="kullanim"
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
            <div className="space-y-1.5">
              <Label htmlFor="not">Not</Label>
              <Textarea
                id="not"
                rows={3}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                Vazgeç
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Kaydediliyor…" : "Kabul et"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={scanOpen} onOpenChange={setScanOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>QR okut veya kodla bul</SheetTitle>
            <SheetDescription>
              Okutma yalnızca silindir kartını açar; hiçbir operasyon başlatmaz.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            <QrScanner onCode={openCode} />
            <div className="space-y-1.5">
              <Label htmlFor="kod">CYL kodu ile ara</Label>
              <div className="flex gap-2">
                <Input
                  id="kod"
                  placeholder="CYL-2026-00001"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openCode(codeInput);
                  }}
                />
                <Button type="button" onClick={() => openCode(codeInput)}>
                  Aç
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function extractCylCode(raw: string): string | null {
  const m = raw.trim().toUpperCase().match(/CYL-\d{4}-\d{4,}/);
  return m ? m[0] : null;
}

/** Kamera varsa QR okur; yoksa kullanıcıyı kodla aramaya yönlendirir. */
function QrScanner({ onCode }: { onCode: (raw: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let stop = false;

    (async () => {
      const Detector = (globalThis as unknown as { BarcodeDetector?: new (o: object) => {
        detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>;
      } }).BarcodeDetector;
      if (!Detector) {
        setError("Bu cihaz/tarayıcı kamera ile QR okumayı desteklemiyor. Kodla arayın.");
        setActive(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch {
        setError("Kameraya erişilemedi. Kodla arayın.");
        setActive(false);
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const detector = new Detector({ formats: ["qr_code"] });
      const tick = async () => {
        if (stop) return;
        try {
          const found = await detector.detect(video);
          if (found[0]?.rawValue) {
            onCode(found[0].rawValue);
            return;
          }
        } catch {
          /* kare atlandı */
        }
        setTimeout(tick, 300);
      };
      tick();
    })();

    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, onCode]);

  return (
    <div className="space-y-2">
      {active ? (
        <video
          ref={videoRef}
          className="aspect-video w-full rounded-md bg-muted object-cover"
          muted
          playsInline
        />
      ) : (
        <Button type="button" variant="outline" className="w-full" onClick={() => setActive(true)}>
          Kamerayı aç
        </Button>
      )}
      {error && <p className="text-xs text-muted-foreground">{error}</p>}
    </div>
  );
}
