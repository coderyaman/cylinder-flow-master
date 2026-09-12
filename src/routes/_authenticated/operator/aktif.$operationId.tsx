import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey } from "@/lib/orders";
import { PLANNED_OP_LABELS, type PlannedOp } from "@/lib/teams";
import {
  elapsedText,
  opErrorText,
  OP_NOTE_LABELS,
  OP_WORKS,
  OP_WORK_LABELS,
  type OpNoteKind,
  type OpWork,
} from "@/lib/operations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
          "Devam eden operasyonu izleyin; not ekleyin, uyarı bırakın, bloke edin veya istasyon formuyla tamamlayın.",
      },
      { property: "og:title", content: "Aktif İş — Operatör — Rotagravür MES" },
      { property: "og:description", content: "Torna ve tekil Sökme tamamlama formları." },
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
  const [note, setNote] = useState("");
  const [noteBody, setNoteBody] = useState("");
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
          "*, stations(code, name), machines(code, name), team_members(kind, planned_ops, cylinder_receipts(cyl_code), teams(team_code, orders(work_order_no, name, critical_note, customers(name))))",
        )
        .eq("id", operationId)
        .maybeSingle();
      if (error) throw error;
      const memberId = (data as any)?.team_member_id;
      const { data: notes } = memberId
        ? await supabase
            .from("operation_notes")
            .select("*")
            .eq("team_member_id", memberId)
            .order("created_at", { ascending: false })
        : { data: [] as any[] };
      return { op: data, notes: notes ?? [] };
    },
  });

  const op: any = q.data?.op;
  const member = op?.team_members;
  const order = member?.teams?.orders;
  const stationCode = op?.stations?.code as string | undefined;
  const isTorna = stationCode === "TORNA";
  const isSokme = stationCode === "SOKME";
  const isOpen = op?.status === "devam";

  async function complete(result: "basarili" | "sorunlu") {
    if (!op) return;
    if (isTorna && works.length === 0) {
      toast.error("Yapılan iş/işler zorunludur.");
      return;
    }
    setBusy(true);
    const { data, error } = isTorna
      ? await supabase.rpc("op_complete_torna", {
          _operation_id: operationId,
          _result: result,
          _works: works,
          _note: note.trim() || undefined,
          _idempotency_key: completeKey,
        })
      : await supabase.rpc("op_complete_sokme", {
          _operation_id: operationId,
          _result: result,
          _note: note.trim() || undefined,
          _idempotency_key: completeKey,
        });
    setBusy(false);
    if (error) {
      toast.error(opErrorText(error.message));
      return;
    }
    const res = data as any;
    if (res?.cyl_code) {
      toast.success(
        `Tamamlandı. Yeni silindir kaydı ${res.cyl_code} oluşturuldu. Aşağı akış için ayrıca Üretime Al kararı gerekir.`,
      );
    } else if (result === "basarili") {
      toast.success(
        res?.next_queued
          ? `Tamamlandı — "${res.next_queued.op_label}" kuyruğuna gönderildi.`
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
          <div>
            <p className="text-xs uppercase text-muted-foreground">Kimlik</p>
            <p className="font-mono">
              {member?.cylinder_receipts?.cyl_code ??
                `Planlanan imalat · ${member?.teams?.team_code ?? ""}`}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Makine</p>
            <p>{op.machines?.name}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Başlangıç</p>
            <p>{new Date(op.started_at).toLocaleString("tr-TR")}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Geçen süre</p>
            <p className="tabular-nums">{elapsedText(op.started_at, now)}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs uppercase text-muted-foreground">Planlanan ek işler</p>
            <p>
              {(member?.planned_ops ?? []).length === 0
                ? "—"
                : (member.planned_ops as PlannedOp[])
                    .map((o) => PLANNED_OP_LABELS[o])
                    .join(", ")}
            </p>
          </div>
          {order?.critical_note && (
            <p className="sm:col-span-2 rounded-md border border-destructive/40 p-3 font-medium text-destructive">
              Kritik not: {order.critical_note}
            </p>
          )}
          {!isOpen && (
            <p className="sm:col-span-2">
              <Badge variant={op.status === "bloke" ? "destructive" : "secondary"}>
                {op.status === "bloke" ? "Bloke" : "Tamamlandı"}
              </Badge>{" "}
              <span className="text-muted-foreground">
                Tamamlanan kayıt operatör tarafından değiştirilemez.
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {isOpen && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Tamamla</CardTitle>
            <CardDescription>
              {isTorna
                ? "Yapılan iş/işler ve sonuç zorunludur."
                : isSokme
                  ? "Sonuç zorunlu, ölçüm zorunlu değil, not isteğe bağlı."
                  : "Bu istasyonun tamamlama formu bu parçada yok."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isTorna && (
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
                          setWorks((prev) =>
                            c ? [...prev, w] : prev.filter((x) => x !== w),
                          )
                        }
                      />
                      {OP_WORK_LABELS[w]}
                    </label>
                  ))}
                </div>
                {member?.kind === "yeni_imalat" && !member?.cylinder_receipts && (
                  <p className="text-xs text-muted-foreground">
                    Yeni imalat başarıyla tamamlanınca tek bir CYL kaydı ve QR oluşur. Çevre, çap
                    ve mil bilgileri yeniden istenmez. Aşağı akış için ayrıca Üretime Al kararı
                    gerekir.
                  </p>
                )}
              </div>
            )}

            {(isTorna || isSokme) && (
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

            {!isTorna && !isSokme && (
              <p className="text-sm text-muted-foreground">
                {op.stations?.name} için zorunlu ölçüm formu henüz geliştirilmedi; genel bir
                Tamamla düğmesiyle geçilemez.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Not / Uyarı / Bloke</CardTitle>
          <CardDescription>
            Uyarı işi otomatik bloke etmez. Bloke edilen iş tamamlanmış sayılmaz.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={2}
            placeholder="Açıklama"
            value={noteBody}
            onChange={(e) => setNoteBody(e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Button
              variant="outline"
              size="lg"
              className="h-14"
              disabled={!canNote || busy}
              onClick={() => addNote("not")}
            >
              Not Ekle
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-14"
              disabled={!canNote || busy}
              onClick={() => addNote("uyari")}
            >
              Uyarı Bırak
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="h-14"
              disabled={!canNote || busy || !isOpen}
              onClick={() => addNote("bloke")}
            >
              Sorun Var / Bloke Et
            </Button>
          </div>

          <div className="space-y-2 pt-2 text-sm">
            {(q.data?.notes ?? []).length === 0 ? (
              <p className="text-muted-foreground">Kayıt yok.</p>
            ) : (
              q.data!.notes.map((n: any) => (
                <div key={n.id} className="flex gap-2">
                  <Badge variant={n.kind === "not" ? "secondary" : "destructive"}>
                    {OP_NOTE_LABELS[n.kind as never]}
                  </Badge>
                  <span>{n.body}</span>
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
