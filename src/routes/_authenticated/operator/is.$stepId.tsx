import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey } from "@/lib/orders";
import { formatMm, SURFACE_LABELS, SHAFT_LABELS } from "@/lib/cylinders";
import { PLANNED_OP_LABELS, type PlannedOp } from "@/lib/teams";
import { opErrorText, OP_NOTE_LABELS } from "@/lib/operations";
import { QrScanner, extractCylCode } from "@/components/qr-scan";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/operator/is/$stepId")({
  validateSearch: (search: Record<string, unknown>) => ({
    qr: typeof search['qr'] === "string" ? (search['qr'] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "İş Kartı — Operatör — Rotagravür MES" },
      {
        name: "description",
        content:
          "İş bilgilerini görün, fiziksel silindirde QR eşleşmesini sağlayın, makine seçip işi başlatın.",
      },
      { property: "og:title", content: "İş Kartı — Operatör — Rotagravür MES" },
      { property: "og:description", content: "Makine seçimi ve operasyon başlatma ekranı." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JobCard,
});

function JobCard() {
  const { stepId } = Route.useParams();
  const { qr } = Route.useSearch();
  const { hasPermission } = useAuth();
  const canStart = hasPermission("operation.start");
  const navigate = useNavigate();

  const [machineId, setMachineId] = useState<string>("");
  const [code, setCode] = useState(qr ?? "");
  const [skipReason, setSkipReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [idemKey] = useState(() => newIdempotencyKey());

  const q = useQuery({
    queryKey: ["op-job", stepId],
    queryFn: async () => {
      const { data: step, error } = await supabase
        .from("route_steps")
        .select(
          "*, stations(id, code, name), route_plans(id, status, team_member_id, team_members(*, cylinder_receipts(*), teams(team_code, orders(*, customers(name)))))",
        )
        .eq("id", stepId)
        .maybeSingle();
      if (error) throw error;
      const stationId = (step as any)?.station_id;
      const { data: machines } = await supabase
        .from("machines")
        .select("id, code, name")
        .eq("station_id", stationId)
        .eq("is_active", true)
        .order("code");
      const { data: busyOps } = await supabase
        .from("operations")
        .select("machine_id")
        .eq("status", "devam");
      const memberId = (step as any)?.route_plans?.team_member_id;
      const { data: notes } = memberId
        ? await supabase
            .from("operation_notes")
            .select("*")
            .eq("team_member_id", memberId)
            .order("created_at", { ascending: false })
        : { data: [] as any[] };
      const { data: existing } = await supabase
        .from("operations")
        .select("id, status")
        .eq("route_step_id", stepId)
        .maybeSingle();
      // Sıra önerisi yalnızca bu adımın kendi istasyon kuyruğuna göre belirlenir.
      const { data: stationQueue } = await supabase
        .from("route_steps")
        .select("id")
        .eq("status", "kuyrukta")
        .eq("station_id", stationId)
        .order("queued_at");
      const startedIds = new Set(
        ((await supabase.from("operations").select("route_step_id")).data ?? []).map(
          (o) => o.route_step_id,
        ),
      );
      const pending = (stationQueue ?? []).filter((s) => !startedIds.has(s.id));
      const isNext = pending.length === 0 || pending[0]?.id === stepId;
      return {
        step,
        machines: machines ?? [],
        busy: new Set((busyOps ?? []).map((o) => o.machine_id)),
        notes: notes ?? [],
        existing,
        isNext,
      };
    },
  });

  const step: any = q.data?.step;
  const member = step?.route_plans?.team_members;
  const receipt = member?.cylinder_receipts;
  const order = member?.teams?.orders;
  const isPlanned = member?.kind === "yeni_imalat" && !receipt;

  async function start() {
    if (!machineId) {
      toast.error("Makine seçin.");
      return;
    }
    if (!isPlanned && !extractCylCode(code)) {
      toast.error("Fiziksel silindirde QR/kod eşleşmesi zorunludur.");
      return;
    }
    setBusy(true);
    const matched = isPlanned ? null : extractCylCode(code);
    const { data, error } = await supabase.rpc("op_start", {
      _step_id: stepId,
      _machine_id: machineId,
      _idempotency_key: idemKey,
      ...(matched ? { _qr_code: matched } : {}),
      ...(skipReason.trim() ? { _skip_queue_reason: skipReason.trim() } : {}),
    });
    setBusy(false);
    if (error) {
      toast.error(opErrorText(error.message));
      return;
    }
    const opId = (data as any)?.operation_id as string;
    toast.success("İş başlatıldı.");
    navigate({ to: "/operator/aktif/$operationId", params: { operationId: opId } });
  }

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (q.isError || !step)
    return <p className="text-sm text-destructive">İş kartı okunamadı.</p>;

  if (q.data?.existing) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-muted-foreground">
          Bu operasyon zaten başlatılmış. Aynı iş ikinci kez başlatılamaz.
        </p>
        <Button asChild>
          <Link
            to="/operator/aktif/$operationId"
            params={{ operationId: q.data.existing.id }}
          >
            Aktif işe git
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/operator" className="text-sm underline">
        ← Operatör ekranı
      </Link>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">
            {step.stations?.name} · {step.op_label}
          </CardTitle>
          <CardDescription>
            {order?.customers?.name} · {order?.work_order_no} · {order?.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Field label="Kimlik">
            <span className="font-mono">
              {receipt?.cyl_code ?? `Planlanan imalat · ${member?.teams?.team_code ?? ""}`}
            </span>
          </Field>
          <Field label="Tür">
            {member?.kind === "mevcut" ? "Fiziksel silindir" : "Planlanan yeni imalat"}
          </Field>
          <Field label="Nominal çevre">{formatMm(order?.nominal_circumference_mm)} mm</Field>
          <Field label="Hedef boy">{formatMm(order?.target_length_mm)} mm</Field>
          {receipt && receipt.measurements_recorded && (
            <>
              <Field label="Ölçülen çevre">
                {formatMm(receipt.measured_circumference_mm)} mm
              </Field>
              <Field label="Ölçülen boy">{formatMm(receipt.measured_length_mm)} mm</Field>
              <Field label="Mil tipi">{SHAFT_LABELS[receipt.shaft_type as never]}</Field>
              <Field label="Yüzey">{SURFACE_LABELS[receipt.surface_state as never]}</Field>
            </>
          )}
          {receipt && !receipt.measurements_recorded && (
            <Field label="Ölçüm">Ölçüm kaydı yok (Torna imalatı)</Field>
          )}
          <Field label="Termin">
            {order?.due_on ? new Date(order.due_on).toLocaleDateString("tr-TR") : "—"}
          </Field>
          <Field label="Öncelik">
            {order?.priority === "normal" ? (
              "Normal"
            ) : (
              <Badge variant="destructive">
                {order?.priority === "acil" ? "Acil" : "Yüksek"}
              </Badge>
            )}
          </Field>
          <Field label="Planlanan ek işler">
            {(member?.planned_ops ?? []).length === 0
              ? "—"
              : (member.planned_ops as PlannedOp[]).map((o) => PLANNED_OP_LABELS[o]).join(", ")}
          </Field>
          {order?.critical_note && (
            <div className="sm:col-span-2">
              <p className="rounded-md border border-destructive/40 p-3 text-sm font-medium text-destructive">
                Kritik not: {order.critical_note}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {(q.data?.notes ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Bu silindirin notları ve uyarıları</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {q.data!.notes.map((n: any) => (
              <div key={n.id} className="flex gap-2">
                <Badge variant={n.kind === "not" ? "secondary" : "destructive"}>
                  {OP_NOTE_LABELS[n.kind as never]}
                </Badge>
                <span>{n.body}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Başlat</CardTitle>
          <CardDescription>
            QR okutmak süreyi başlatmaz. Makineyi seçip Başlat'a basın.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isPlanned && (
            <div className="space-y-2">
              <Label htmlFor="qr">QR / CYL kodu eşleşmesi (zorunlu)</Label>
              <Input
                id="qr"
                className="h-12 text-base"
                placeholder="CYL-2026-00001"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <QrScanner onCode={(raw) => setCode(extractCylCode(raw) ?? raw)} />
            </div>
          )}
          {isPlanned && (
            <p className="text-sm text-muted-foreground">
              Planlanan yeni imalat: bu aşamada fiziksel QR aranmaz.
            </p>
          )}

          <div className="space-y-2">
            <Label>Makine</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {q.data!.machines.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Bu istasyonda tanımlı aktif makine yok.
                </p>
              )}
              {q.data!.machines.map((m: any) => {
                const isBusy = q.data!.busy.has(m.id);
                return (
                  <Button
                    key={m.id}
                    type="button"
                    variant={machineId === m.id ? "default" : "outline"}
                    className="h-14 justify-start text-base"
                    disabled={isBusy}
                    onClick={() => setMachineId(m.id)}
                  >
                    {m.name}
                    {isBusy && <span className="ml-2 text-xs">(meşgul)</span>}
                  </Button>
                );
              })}
            </div>
          </div>

          {!q.data?.isNext && (
            <div className="space-y-2">
              <Label htmlFor="skip">
                {step.stations?.name} kuyruğunda sıradaki iş yerine bu işi alıyorsanız gerekçe
              </Label>
              <Textarea
                id="skip"
                rows={2}
                placeholder="Örn. fiziksel silindir henüz gelmedi, usta talimatı"
                value={skipReason}
                onChange={(e) => setSkipReason(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Bu gerekçe rota adımını atlamaz; yalnızca kuyruk sırası değişikliğini kaydeder.
              </p>
            </div>
          )}

          <Button
            size="lg"
            className="h-16 w-full text-lg"
            disabled={!canStart || busy}
            onClick={start}
          >
            {busy ? "Başlatılıyor…" : "Başlat"}
          </Button>
          {!canStart && (
            <p className="text-xs text-muted-foreground">Başlatma yetkiniz yok.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p>{children}</p>
    </div>
  );
}
