import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { operationGraphicLink } from "@/lib/operator-graphics.functions";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey } from "@/lib/orders";
import { formatMm, parseTrNumber } from "@/lib/cylinders";
import { PLANNED_OP_LABELS, type PlannedOp } from "@/lib/teams";
import {
  elapsedText,
  opErrorText,
  BAKIR_WORKS,
  BAKIR_WORK_LABELS,
  OP_NOTE_LABELS,
  OP_WORKS,
  OP_WORK_LABELS,
  type BakirWork,
  type OpNoteKind,
  type OpWork,
} from "@/lib/operations";
import {
  QUALITY_ACTIONS,
  QUALITY_ACTION_LABELS,
  type QualityAction,
} from "@/lib/quality";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

export const Route = createFileRoute("/_authenticated/operator/aktif/$operationId")({
  head: () => ({
    meta: [
      { title: "Aktif İş — Operatör — Rotagravür MES" },
      {
        name: "description",
        content:
          "Devam eden operasyonu izleyin; istasyon formuyla tamamlayın, not ekleyin, uyarı bırakın veya bloke edin.",
      },
      { property: "og:title", content: "Aktif İş — Operatör — Rotagravür MES" },
      {
        property: "og:description",
        content: "Torna, Sökme, Bakır, Taşlama, CFM, Gravür ve Krom tamamlama formları.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ActiveJob,
});

function ActiveJob() {
  const { operationId } = Route.useParams();
  const { hasPermission } = useAuth();
  const canComplete = hasPermission("operation.complete");
  const canNote = hasPermission("quality.request");
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [now, setNow] = useState(() => Date.now());
  const [works, setWorks] = useState<OpWork[]>([]);
  const [bakirWorks, setBakirWorks] = useState<BakirWork[]>([]);
  const [circ, setCirc] = useState("");
  const [diam, setDiam] = useState("");
  const [coating, setCoating] = useState("");
  const [stage, setStage] = useState("");
  const [note, setNote] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [category, setCategory] = useState("");
  const [action, setAction] = useState<QualityAction>("bilinmiyor");
  const [masterNote, setMasterNote] = useState("");
  const [removedFromMachine, setRemovedFromMachine] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completeKey, setCompleteKey] = useState(() => newIdempotencyKey());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const q = useQuery({
    queryKey: ["op-detail", operationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operations")
        .select(
          "*, stations(code, name), machines(code, name), team_members(*, cylinder_receipts(cyl_code, measured_circumference_mm, measured_length_mm), teams(id, team_code, proof_queued_at, orders(work_order_no, name, critical_note, nominal_circumference_mm, target_length_mm, customers(name))))",
        )
        .eq("id", operationId)
        .maybeSingle();
      if (error) throw error;
      const op: any = data;
      const memberId = op?.team_member_id as string | undefined;
      const teamId = op?.team_members?.teams?.id as string | undefined;

      const { data: notes } = memberId
        ? await supabase
            .from("operation_notes")
            .select("*")
            .eq("team_member_id", memberId)
            .order("created_at", { ascending: false })
        : { data: [] as any[] };

      const { data: mine } = memberId
        ? await supabase
            .from("operation_measurements")
            .select("*")
            .eq("team_member_id", memberId)
            .order("measured_at", { ascending: false })
        : { data: [] as any[] };

      const { data: teamMembers } = teamId
        ? await supabase
            .from("team_members")
            .select(
              "id, stage_no, is_active, receipt_id, proof_ready_at, cylinder_receipts(cyl_code)",
            )
            .eq("team_id", teamId)
            .order("sequence_no")
        : { data: [] as any[] };

      const ids = (teamMembers ?? []).map((m: any) => m.id);
      const { data: teamMeasurements } =
        ids.length > 0
          ? await supabase
              .from("operation_measurements")
              .select("team_member_id, station_code, circumference_mm, diameter_mm, measured_at")
              .in("team_member_id", ids)
              .order("measured_at", { ascending: false })
          : { data: [] as any[] };

      const { data: categories } = await supabase
        .from("defect_categories")
        .select("code, label")
        .eq("is_active", true)
        .eq("assessed_cause_only", false)
        .order("sort_order");

      return {
        op,
        notes: notes ?? [],
        mine: mine ?? [],
        teamMembers: teamMembers ?? [],
        teamMeasurements: teamMeasurements ?? [],
        categories: categories ?? [],
      };
    },
  });

  const op: any = q.data?.op;
  const member = op?.team_members;
  const order = member?.teams?.orders;
  const stationCode = op?.stations?.code as string | undefined;
  const isOpen = op?.status === "devam";

  const needsMeasure = stationCode === "BAKIR" || stationCode === "TASLAMA";
  const hasForm =
    stationCode !== undefined &&
    ["TORNA", "SOKME", "BAKIR", "TASLAMA", "CFM", "GRAVUR", "KROM"].includes(stationCode);

  const activeMembers = (q.data?.teamMembers ?? []).filter((m: any) => m.is_active);
  const readyCount = activeMembers.filter(
    (m: any) => m.proof_ready_at && m.receipt_id,
  ).length;

  function lastTaslama(memberId: string) {
    return (q.data?.teamMeasurements ?? []).find(
      (x: any) => x.team_member_id === memberId && x.station_code === "TASLAMA",
    );
  }

  async function openGraphic() {
    // Sekme dokunma anında açılır; imzalı bağlantı gelince içine yüklenir.
    // Beklemeden sonra açmak tarayıcı engeline takılıyor.
    const tab = window.open("", "_blank");
    setBusy(true);
    try {
      const res = await operationGraphicLink({ data: { operationId } });
      if (tab) tab.location.href = res.url;
      else window.location.href = res.url;
      toast.success(`Revizyon ${res.revisionNo} açıldı.`);
    } catch (e) {
      tab?.close();
      toast.error(opErrorText((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function complete(result: "basarili" | "sorunlu") {
    if (!op || !stationCode) return;

    let circN: number | null = null;
    let diamN: number | null = null;
    let coatN: number | null = null;
    let stageN: number | null = null;

    const invalid = (msg: string) => {
      toast.error(msg);
      return true;
    };

    if (needsMeasure) {
      if (circ.trim()) {
        circN = parseTrNumber(circ);
        if (circN === null && invalid("Son çevre geçersiz. Sıfır veya negatif olamaz.")) return;
      }
      if (diam.trim()) {
        diamN = parseTrNumber(diam);
        if (diamN === null && invalid("Son çap geçersiz. Sıfır veya negatif olamaz.")) return;
      }
    }
    if (stationCode === "BAKIR" && coating.trim()) {
      coatN = parseTrNumber(coating);
      if (coatN === null && invalid("Kaplama kalınlığı geçersiz.")) return;
    }
    if (stationCode === "TASLAMA" && stage.trim()) {
      const s = Number(stage.trim());
      if ((!Number.isInteger(s) || s < 1) && invalid("Kademe 1 veya daha büyük olmalıdır.")) return;
      stageN = s;
    }

    if (result === "basarili") {
      if (stationCode === "TORNA" && works.length === 0) {
        invalid("Yapılan iş/işler zorunludur.");
        return;
      }
      if (stationCode === "BAKIR") {
        if (bakirWorks.length === 0) {
          invalid("Yapılan iş/işler zorunludur.");
          return;
        }
        if (circN === null || diamN === null || coatN === null) {
          invalid("Son çevre, son çap ve kaplama kalınlığı zorunludur.");
          return;
        }
      }
      if (stationCode === "TASLAMA") {
        if (stageN === null) {
          invalid("Kademe/Renk sırası zorunludur.");
          return;
        }
        if (circN === null || diamN === null) {
          invalid("Son çevre ve son çap zorunludur.");
          return;
        }
      }
    }

    setBusy(true);
    const noteArg = note.trim() ? { _note: note.trim() } : {};
    let res: { data: any; error: any };
    if (stationCode === "TORNA") {
      res = await supabase.rpc("op_complete_torna", {
        _operation_id: operationId,
        _result: result,
        _works: works,
        _idempotency_key: completeKey,
        ...noteArg,
      });
    } else if (stationCode === "SOKME") {
      res = await supabase.rpc("op_complete_sokme", {
        _operation_id: operationId,
        _result: result,
        _idempotency_key: completeKey,
        ...noteArg,
      });
    } else if (stationCode === "BAKIR") {
      res = await supabase.rpc("op_complete_bakir", {
        _operation_id: operationId,
        _result: result,
        _works: bakirWorks,
        _idempotency_key: completeKey,
        ...(circN !== null ? { _circumference_mm: circN } : {}),
        ...(diamN !== null ? { _diameter_mm: diamN } : {}),
        ...(coatN !== null ? { _coating_thickness_um: coatN } : {}),
        ...noteArg,
      });
    } else if (stationCode === "TASLAMA") {
      res = await supabase.rpc("op_complete_taslama", {
        _operation_id: operationId,
        _result: result,
        _idempotency_key: completeKey,
        ...(stageN !== null ? { _stage_no: stageN } : {}),
        ...(circN !== null ? { _circumference_mm: circN } : {}),
        ...(diamN !== null ? { _diameter_mm: diamN } : {}),
        ...noteArg,
      });
    } else if (stationCode === "KROM") {
      res = await supabase.rpc("op_complete_krom", {
        _operation_id: operationId,
        _result: result,
        _idempotency_key: completeKey,
        ...noteArg,
      });
    } else {
      res = await supabase.rpc("op_complete_simple", {
        _operation_id: operationId,
        _station_code: stationCode,
        _result: result,
        _idempotency_key: completeKey,
        ...noteArg,
      });
    }
    setBusy(false);

    if (res.error) {
      toast.error(opErrorText(res.error.message));
      return;
    }
    const out = res.data as any;
    if (out?.cyl_code) {
      toast.success(
        `Tamamlandı. Yeni silindir kaydı ${out.cyl_code} oluşturuldu. Aşağı akış için ayrıca Üretime Al kararı gerekir.`,
      );
    } else if (result === "basarili" && stationCode === "KROM") {
      toast.success(
        out?.team_queued
          ? `Tamamlandı. Takım hazırlığı ${out.ready}/${out.total}: takım Prova kuyruğuna girdi. Bu onay veya sevkiyat değildir.`
          : `Tamamlandı. Silindir Prova İçin Hazır. Takım hazırlığı ${out?.ready}/${out?.total}.`,
      );
    } else if (result === "basarili") {
      toast.success(
        out?.next_queued
          ? `Tamamlandı — "${out.next_queued.op_label}" kuyruğuna gönderildi.`
          : "Tamamlandı. Sıradaki adım yok.",
      );
    } else {
      toast.warning("Sorunlu sonuç kaydedildi. İş bloke edildi, sonraki kuyruğa geçmedi.");
    }
    await qc.invalidateQueries();
    navigate({ to: "/operator" });
  }

  async function addNote(kind: OpNoteKind) {
    if (!noteBody.trim()) {
      toast.error("Açıklama yazın.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("op_add_note", {
      _operation_id: operationId,
      _kind: kind,
      _body: noteBody.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error(opErrorText(error.message));
      return;
    }
    setNoteBody("");
    setCompleteKey(newIdempotencyKey());
    toast.success(kind === "bloke" ? "İş bloke edildi." : "Kaydedildi.");
    await qc.invalidateQueries({ queryKey: ["op-detail", operationId] });
  }

  async function report(severity: "uyari" | "bloke") {
    if (!category) {
      toast.error("Hata kategorisi seçin.");
      return;
    }
    if (!noteBody.trim()) {
      toast.error("Açıklama zorunludur.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("quality_report", {
      _operation_id: operationId,
      _severity: severity,
      _category_code: category,
      _description: noteBody.trim(),
      _proposed_action: action,
      _cylinder_removed: removedFromMachine,
      _idempotency_key: newIdempotencyKey(),
      ...(masterNote.trim() ? { _master_consult_note: masterNote.trim() } : {}),
    });
    setBusy(false);
    if (error) {
      toast.error(opErrorText(error.message));
      return;
    }
    setNoteBody("");
    setMasterNote("");
    setCategory("");
    setCompleteKey(newIdempotencyKey());
    toast.success(
      severity === "bloke"
        ? removedFromMachine
          ? "Bloke edildi ve karar bekleyenlere düştü. Makine bağı serbest bırakıldı."
          : "Bloke edildi ve karar bekleyenlere düştü. Silindir makinede olduğu için makine işgali sürüyor."
        : "Uyarı kaydedildi; üretim devam eder ve uyarı sonraki istasyonda görünür.",
    );
    await qc.invalidateQueries({ queryKey: ["op-detail", operationId] });
  }

  async function ackNote(noteId: string) {
    setBusy(true);
    const { error } = await supabase.rpc("op_ack_note", { _note_id: noteId });
    setBusy(false);
    if (error) {
      toast.error(opErrorText(error.message));
      return;
    }
    toast.success("Uyarı kontrol edildi olarak kapatıldı.");
    await qc.invalidateQueries({ queryKey: ["op-detail", operationId] });
  }

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (q.isError || !op) return <p className="text-sm text-destructive">İş okunamadı.</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/operator" className="text-sm underline">
        ← Operatör ekranı
      </Link>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">
            {op.stations?.name} · {op.op_label}
          </CardTitle>
          <CardDescription>
            {order?.customers?.name} · {order?.work_order_no} · {order?.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Field label="Kimlik">
            <span className="font-mono">
              {member?.cylinder_receipts?.cyl_code ??
                `Planlanan imalat · ${member?.teams?.team_code ?? ""}`}
            </span>
          </Field>
          <Field label="Kademe / Renk sırası">
            {member?.stage_no ?? "Atanmadı"}
          </Field>
          <Field label="Makine">{op.machines?.name}</Field>
          <Field label="Geçen süre">
            <span className="tabular-nums">{elapsedText(op.started_at, now)}</span>
          </Field>
          <Field label="Nominal çevre">{formatMm(order?.nominal_circumference_mm)} mm</Field>
          <Field label="Hedef boy">{formatMm(order?.target_length_mm)} mm</Field>
          <Field label="Başlangıç">{new Date(op.started_at).toLocaleString("tr-TR")}</Field>
          <Field label="Planlanan ek işler">
            {(member?.planned_ops ?? []).length === 0
              ? "—"
              : (member.planned_ops as PlannedOp[]).map((o) => PLANNED_OP_LABELS[o]).join(", ")}
          </Field>
          {order?.critical_note && (
            <p className="sm:col-span-2 rounded-md border border-destructive/40 p-3 font-medium text-destructive">
              Kritik not: {order.critical_note}
            </p>
          )}
          {!isOpen && (
            <div className="sm:col-span-2">
              <Badge variant={op.status === "bloke" ? "destructive" : "secondary"}>
                {op.status === "bloke" ? "Bloke" : "Tamamlandı"}
              </Badge>{" "}
              <span className="text-muted-foreground">
                Tamamlanan kayıt operatör tarafından değiştirilemez.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {(q.data?.mine ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Bu silindirin ölçüm geçmişi</CardTitle>
            <CardDescription>Her ölçüm ayrı kayıttır; önceki değerin üstüne yazılmaz.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {q.data!.mine.map((r: any) => (
              <div key={r.id} className="flex flex-wrap gap-x-4">
                <span className="font-medium">{r.station_code}</span>
                <span>Çevre: {formatMm(r.circumference_mm)} mm</span>
                <span>Çap: {formatMm(r.diameter_mm)} mm</span>
                {r.coating_thickness_um && (
                  <span>Kalınlık: {formatMm(r.coating_thickness_um)} µm</span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(r.measured_at).toLocaleString("tr-TR")}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {stationCode === "TASLAMA" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Takım kademeleri ve gerçekleşen ölçüler</CardTitle>
            <CardDescription>
              Nominal: {formatMm(order?.nominal_circumference_mm)} mm. Farklar bilgi amaçlıdır;
              sistem hedef kademe ölçüsü hesaplamaz.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="py-1">Kademe</th>
                  <th>Silindir</th>
                  <th className="text-right">Son çevre</th>
                  <th className="text-right">Son çap</th>
                  <th className="text-right">Nominal fark</th>
                </tr>
              </thead>
              <tbody>
                {activeMembers.map((m: any) => {
                  const meas = lastTaslama(m.id);
                  const d =
                    meas?.circumference_mm && order?.nominal_circumference_mm
                      ? Number(meas.circumference_mm) - Number(order.nominal_circumference_mm)
                      : null;
                  return (
                    <tr key={m.id} className={m.id === member?.id ? "font-medium" : ""}>
                      <td className="py-1">{m.stage_no ?? "—"}</td>
                      <td className="font-mono">
                        {m.cylinder_receipts?.cyl_code ?? "Planlanan imalat"}
                      </td>
                      <td className="text-right tabular-nums">
                        {meas ? `${formatMm(meas.circumference_mm)} mm` : "—"}
                      </td>
                      <td className="text-right tabular-nums">
                        {meas ? `${formatMm(meas.diameter_mm)} mm` : "—"}
                      </td>
                      <td className="text-right tabular-nums">
                        {d === null ? "—" : `${d > 0 ? "+" : ""}${formatMm(d)} mm`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {stationCode === "KROM" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Takım hazırlığı: {readyCount}/{activeMembers.length}
            </CardTitle>
            <CardDescription>
              Planlanan fakat imal edilmemiş üye hazır sayılmaz. Prova kuyruğuna giriş onay veya
              sevkiyat değildir.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {stationCode === "GRAVUR" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Grafik</CardTitle>
            <CardDescription>
              Tram, açı, çizgi ve derinlik bilgileri PDF'te kalır; tekrar girilmez. Bu iş
              başlangıçtaki revizyona bağlıdır; sonradan yüklenen dosya bu işi değiştirmez.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="lg" className="h-16 w-full text-lg" disabled={busy} onClick={openGraphic}>
              Grafik PDF'ini Aç
            </Button>
          </CardContent>
        </Card>
      )}

      {isOpen && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tamamla</CardTitle>
            <CardDescription>
              {stationCode === "TORNA" && "Yapılan iş/işler ve sonuç zorunludur."}
              {stationCode === "SOKME" &&
                "Sonuç zorunlu, ölçüm zorunlu değil, not isteğe bağlı."}
              {stationCode === "BAKIR" &&
                "Yapılan iş/işler, son çevre (mm), son çap (mm), kaplama kalınlığı (µm) ve sonuç zorunludur."}
              {stationCode === "TASLAMA" &&
                "Kademe/Renk sırası, son çevre (mm), son çap (mm) ve sonuç zorunludur."}
              {stationCode === "CFM" &&
                "Ek teknik ölçüm yoktur. Başarılı Tamamla yeterli, not isteğe bağlı."}
              {stationCode === "GRAVUR" && "Sonuç zorunlu, not isteğe bağlı."}
              {stationCode === "KROM" &&
                "Teknik ölçüm zorunlu değil. Başarı silindiri Prova İçin Hazır yapar."}
              {!hasForm && "Bu istasyonun tamamlama formu tanımlı değil."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stationCode === "TORNA" && (
              <div className="space-y-2">
                <Label>Yapılan iş/işler</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {OP_WORKS.map((w) => (
                    <label
                      key={w}
                      className="flex items-center gap-3 rounded-md border border-border p-3 text-base"
                    >
                      <Checkbox
                        checked={works.includes(w)}
                        onCheckedChange={(c) =>
                          setWorks((prev) => (c ? [...prev, w] : prev.filter((x) => x !== w)))
                        }
                      />
                      {OP_WORK_LABELS[w]}
                    </label>
                  ))}
                </div>
                {member?.kind === "yeni_imalat" && !member?.cylinder_receipts && (
                  <p className="text-xs text-muted-foreground">
                    Yeni imalat başarıyla tamamlanınca tek bir CYL kaydı ve QR oluşur. Aşağı akış
                    için ayrıca Üretime Al kararı gerekir.
                  </p>
                )}
              </div>
            )}

            {stationCode === "BAKIR" && (
              <div className="space-y-2">
                <Label>Yapılan iş/işler (birden çok seçilebilir)</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {BAKIR_WORKS.map((w) => (
                    <label
                      key={w}
                      className="flex items-center gap-3 rounded-md border border-border p-3 text-base"
                    >
                      <Checkbox
                        checked={bakirWorks.includes(w)}
                        onCheckedChange={(c) =>
                          setBakirWorks((prev) =>
                            c ? [...prev, w] : prev.filter((x) => x !== w),
                          )
                        }
                      />
                      {BAKIR_WORK_LABELS[w]}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Ücretli/ücretsiz kararı operatörde değildir; yalnızca gerçekleşen iş girilir.
                </p>
              </div>
            )}

            {stationCode === "TASLAMA" && (
              <div className="space-y-2">
                <Label htmlFor="kademe">Kademe / Renk sırası (1…{activeMembers.length})</Label>
                <Input
                  id="kademe"
                  inputMode="numeric"
                  className="h-12 text-base"
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                />
              </div>
            )}

            {needsMeasure && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="circ">Son çevre (mm)</Label>
                  <Input
                    id="circ"
                    inputMode="decimal"
                    placeholder="523,40"
                    className="h-12 text-base"
                    value={circ}
                    onChange={(e) => setCirc(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="diam">Son çap (mm)</Label>
                  <Input
                    id="diam"
                    inputMode="decimal"
                    placeholder="166,60"
                    className="h-12 text-base"
                    value={diam}
                    onChange={(e) => setDiam(e.target.value)}
                  />
                </div>
                {stationCode === "BAKIR" && (
                  <div className="space-y-2">
                    <Label htmlFor="coat">Kaplama kalınlığı (µm)</Label>
                    <Input
                      id="coat"
                      inputMode="decimal"
                      placeholder="80"
                      className="h-12 text-base"
                      value={coating}
                      onChange={(e) => setCoating(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {hasForm && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="sonucnot">Not (isteğe bağlı)</Label>
                  <Textarea
                    id="sonucnot"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    size="lg"
                    className="h-16 text-lg"
                    disabled={!canComplete || busy}
                    onClick={() => complete("basarili")}
                  >
                    Tamamla — Başarılı
                  </Button>
                  <Button
                    size="lg"
                    variant="destructive"
                    className="h-16 text-lg"
                    disabled={!canComplete || busy}
                    onClick={() => complete("sorunlu")}
                  >
                    Tamamla — Sorunlu
                  </Button>
                </div>
              </>
            )}

            {!hasForm && (
              <p className="text-sm text-muted-foreground">
                {op.stations?.name} için tamamlama formu henüz geliştirilmedi; genel bir Tamamla
                düğmesiyle geçilemez.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Not / Uyarı / Bloke</CardTitle>
          <CardDescription>
            Uyarı üretimi durdurmaz; sonraki istasyonda görünür ve "Kontrol Edildi" ile kapanır.
            Bloke edilen silindirde yeni operasyon başlatılamaz ve iş normal başarıyla sonraki
            kuyruğa gönderilemez.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notbody">Açıklama</Label>
            <Textarea
              id="notbody"
              rows={2}
              placeholder="Ne gördünüz?"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
            />
          </div>

          <Button
            variant="outline"
            size="lg"
            className="h-14 w-full"
            disabled={!canNote || busy}
            onClick={() => addNote("not")}
          >
            Sadece Not Ekle
          </Button>

          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm font-medium">Uyarı / Sorun bildirimi</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="kategori">Hata kategorisi</Label>
                <select
                  id="kategori"
                  className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">Seçin…</option>
                  {(q.data?.categories ?? []).map((c: any) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="oneri">Önerim (karar yerine geçmez)</Label>
                <select
                  id="oneri"
                  className="h-12 w-full rounded-md border border-input bg-background px-3 text-base"
                  value={action}
                  onChange={(e) => setAction(e.target.value as QualityAction)}
                >
                  {QUALITY_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {QUALITY_ACTION_LABELS[a]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="usta">Ustaya danışma notu (isteğe bağlı)</Label>
              <Textarea
                id="usta"
                rows={2}
                placeholder="Ustama danıştım / onay aldım…"
                value={masterNote}
                onChange={(e) => setMasterNote(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Acil bloke için ön koşul değildir ve yönetici kararının yerine geçmez.
              </p>
            </div>
            <label className="flex items-center gap-3 rounded-md border border-border p-3 text-base">
              <Checkbox
                checked={removedFromMachine}
                onCheckedChange={(c) => setRemovedFromMachine(!!c)}
              />
              Silindir makineden çıkarıldı
            </label>
            <p className="text-xs text-muted-foreground">
              Çıkarılmadıysa makine işgali korunur; makine arızası bu işlemle kapanmaz.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button
                variant="outline"
                size="lg"
                className="h-14"
                disabled={!canNote || busy}
                onClick={() => report("uyari")}
              >
                Uyarı Bırak
              </Button>
              <Button
                variant="destructive"
                size="lg"
                className="h-14"
                disabled={!canNote || busy || !isOpen}
                onClick={() => report("bloke")}
              >
                Sorun Var / Bloke Et
              </Button>
            </div>
          </div>

          <div className="space-y-2 pt-2 text-sm">
            {(q.data?.notes ?? []).length === 0 ? (
              <p className="text-muted-foreground">Kayıt yok.</p>
            ) : (
              q.data!.notes.map((n: any) => (
                <div key={n.id} className="flex flex-wrap items-center gap-2">
                  <Badge variant={n.kind === "not" ? "secondary" : "destructive"}>
                    {OP_NOTE_LABELS[n.kind as never]}
                  </Badge>
                  <span>{n.body}</span>
                  {n.kind === "uyari" &&
                    (n.acknowledged_at ? (
                      <Badge variant="outline">
                        Kontrol edildi · {new Date(n.acknowledged_at).toLocaleString("tr-TR")}
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canNote || busy}
                        onClick={() => ackNote(n.id)}
                      >
                        Kontrol Edildi
                      </Button>
                    ))}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(n.created_at).toLocaleString("tr-TR")}
                  </span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  );
}
