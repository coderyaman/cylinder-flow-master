import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey } from "@/lib/orders";
import { formatMm } from "@/lib/cylinders";
import { opErrorText, OP_NOTE_LABELS } from "@/lib/operations";
import {
  billableText,
  QUALITY_ACTION_LABELS,
  QUALITY_DECISION_LABELS,
  QUALITY_DECISIONS,
  QUALITY_STATUS_LABELS,
  RESPONSIBILITIES,
  RESPONSIBILITY_LABELS,
  waitingText,
  type QualityDecision,
  type QualityResponsibility,
} from "@/lib/quality";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/kalite")({
  head: () => ({
    meta: [
      { title: "Kalite / Karar Bekleyenler — Rotagravür MES" },
      {
        name: "description",
        content:
          "Bildirilen uyarı ve blokeleri inceleyin; devam, onaylı rework, silindir değiştirme, red veya ek bilgi kararını gerekçesiyle kaydedin.",
      },
      { property: "og:title", content: "Kalite / Karar Bekleyenler — Rotagravür MES" },
      {
        property: "og:description",
        content: "Tespit istasyonu, gözlenen hata, kaynak neden ve ticari sorumluluk ayrı kayıtlar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QualityPage,
});

function QualityPage() {
  const { hasPermission } = useAuth();
  const canDecide = hasPermission("rework.approve");
  const qc = useQueryClient();

  const [now, setNow] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const list = useQuery({
    queryKey: ["quality-issues", showClosed],
    queryFn: async () => {
      let query = supabase
        .from("quality_issues")
        .select(
          "*, stations(code, name), defect_categories!quality_issues_category_code_fkey(label), cylinder_receipts(cyl_code), team_members(id, stage_no, teams(team_code, orders(work_order_no, name, customers(name))))",
        )
        .order("requested_at", { ascending: false });
      if (!showClosed) query = query.in("status", ["acik", "bilgi_bekleniyor", "karar_verildi"]);
      const { data, error } = await query;
      if (error) throw error;
      const ids = [...new Set((data ?? []).map((r: any) => r.requested_by).filter(Boolean))];
      const { data: people } = ids.length
        ? await supabase.from("profiles").select("id, full_name").in("id", ids)
        : { data: [] as any[] };
      const names = new Map((people ?? []).map((p: any) => [p.id, p.full_name]));
      return (data ?? []).map((r: any) => ({ ...r, requester: names.get(r.requested_by) ?? "—" }));
    },
  });

  const rows = list.data ?? [];
  const current = rows.find((r: any) => r.id === selected) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold">Kalite / Karar Bekleyenler</h1>
          <p className="text-sm text-muted-foreground">
            Hatayı bulan operatör veya istasyon otomatik sorumlu sayılmaz; kaynak neden bilinmiyorsa
            bilinmiyor kalır.
          </p>
        </div>
        <Button variant="outline" className="ml-auto" onClick={() => setShowClosed((v) => !v)}>
          {showClosed ? "Yalnızca açık kayıtlar" : "Kapananları da göster"}
        </Button>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="p-2">Firma</th>
                <th className="p-2">İş emri</th>
                <th className="p-2">Silindir</th>
                <th className="p-2">Tespit istasyonu</th>
                <th className="p-2">Hata kategorisi</th>
                <th className="p-2">Açıklama</th>
                <th className="p-2">Talep eden</th>
                <th className="p-2">Bekleme</th>
                <th className="p-2">Durum</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading && (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={9}>
                    Yükleniyor…
                  </td>
                </tr>
              )}
              {!list.isLoading && rows.length === 0 && (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={9}>
                    Karar bekleyen kayıt yok.
                  </td>
                </tr>
              )}
              {rows.map((r: any) => (
                <tr
                  key={r.id}
                  className={`cursor-pointer border-b border-border/60 hover:bg-accent ${
                    selected === r.id ? "bg-accent" : ""
                  }`}
                  onClick={() => setSelected(r.id)}
                >
                  <td className="p-2">{r.team_members?.teams?.orders?.customers?.name ?? "—"}</td>
                  <td className="p-2 font-mono">
                    {r.team_members?.teams?.orders?.work_order_no ?? "—"}
                  </td>
                  <td className="p-2 font-mono">
                    {r.cylinder_receipts?.cyl_code ?? "Planlanan imalat"}
                  </td>
                  <td className="p-2">{r.stations?.name}</td>
                  <td className="p-2">{r.defect_categories?.label}</td>
                  <td className="max-w-[24rem] truncate p-2">{r.description}</td>
                  <td className="p-2">{r.requester}</td>
                  <td className="p-2 tabular-nums">{waitingText(r.requested_at, now)}</td>
                  <td className="p-2">
                    <Badge variant={r.severity === "bloke" ? "destructive" : "secondary"}>
                      {r.severity === "bloke" ? "Bloke" : "Uyarı"}
                    </Badge>{" "}
                    <span className="text-xs">{QUALITY_STATUS_LABELS[r.status as never]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {current && (
        <IssueDetail
          issue={current}
          canDecide={canDecide}
          onDone={async () => {
            await qc.invalidateQueries();
          }}
        />
      )}
    </div>
  );
}

function IssueDetail({
  issue,
  canDecide,
  onDone,
}: {
  issue: any;
  canDecide: boolean;
  onDone: () => Promise<void>;
}) {
  const [decision, setDecision] = useState<QualityDecision>("devam");
  const [reason, setReason] = useState("");
  const [cause, setCause] = useState("");
  const [resp, setResp] = useState<QualityResponsibility>("bilinmiyor");
  const [busy, setBusy] = useState(false);

  const detail = useQuery({
    queryKey: ["quality-detail", issue.id],
    queryFn: async () => {
      const memberId = issue.team_member_id as string;
      const { data: ops } = await supabase
        .from("operations")
        .select("*, stations(name), machines(name)")
        .eq("team_member_id", memberId)
        .order("started_at", { ascending: false });
      const { data: meas } = await supabase
        .from("operation_measurements")
        .select("*")
        .eq("team_member_id", memberId)
        .order("measured_at", { ascending: false });
      const { data: notes } = await supabase
        .from("operation_notes")
        .select("*")
        .eq("team_member_id", memberId)
        .order("created_at", { ascending: false });
      const { data: causes } = await supabase
        .from("defect_categories")
        .select("code, label")
        .eq("is_active", true)
        .order("sort_order");
      return { ops: ops ?? [], meas: meas ?? [], notes: notes ?? [], causes: causes ?? [] };
    },
  });

  async function decide() {
    if (!reason.trim()) {
      toast.error("Karar gerekçesi zorunludur.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("quality_decide", {
      _issue_id: issue.id,
      _decision: decision,
      _reason: reason.trim(),
      _responsibility: resp,
      _idempotency_key: newIdempotencyKey(),
      ...(cause ? { _root_cause_code: cause } : {}),
    });
    setBusy(false);
    if (error) {
      toast.error(opErrorText(error.message));
      return;
    }
    setReason("");
    toast.success(
      decision === "red"
        ? "Talep reddedildi. Bloke otomatik kalkmaz."
        : "Karar kaydedildi.",
    );
    await onDone();
  }

  async function resume() {
    setBusy(true);
    const { error } = await supabase.rpc("quality_resume_flow", {
      _issue_id: issue.id,
      _idempotency_key: newIdempotencyKey(),
    });
    setBusy(false);
    if (error) {
      toast.error(opErrorText(error.message));
      return;
    }
    toast.success("Bloke kaldırıldı; mevcut akışa devam edildi.");
    await onDone();
  }

  async function releaseMachine() {
    setBusy(true);
    const { error } = await supabase.rpc("quality_release_machine", { _issue_id: issue.id });
    setBusy(false);
    if (error) {
      toast.error(opErrorText(error.message));
      return;
    }
    toast.success("Makine bağı serbest bırakıldı. Makine arızası bu işlemle kapanmaz.");
    await onDone();
  }

  const order = issue.team_members?.teams?.orders;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          Sorun detayı · {issue.cylinder_receipts?.cyl_code ?? "Planlanan imalat"}
        </CardTitle>
        <CardDescription>
          {order?.customers?.name} · {order?.work_order_no} · {order?.name}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <Info label="Tespit istasyonu">{issue.stations?.name}</Info>
          <Info label="Gözlenen hata">{issue.defect_categories?.label}</Info>
          <Info label="Talep eden">{issue.requester}</Info>
          <Info label="Operatör önerisi">
            {QUALITY_ACTION_LABELS[issue.proposed_action as never]}
          </Info>
          <Info label="Usta danışma notu">{issue.master_consult_note ?? "—"}</Info>
          <Info label="Makine">
            {issue.cylinder_removed
              ? "Silindir makineden çıkarıldı"
              : "Silindir makinede — makine işgali sürüyor"}
          </Info>
          <Info label="Değerlendirilen kaynak neden">
            {issue.root_cause_code
              ? (detail.data?.causes ?? []).find((c: any) => c.code === issue.root_cause_code)
                  ?.label ?? issue.root_cause_code
              : "Bilinmiyor"}
          </Info>
          <Info label="Ticari sorumluluk">
            {RESPONSIBILITY_LABELS[issue.responsibility as never]}
          </Info>
          <Info label="Faturalandırma">{billableText(issue.billable)}</Info>
        </div>
        <p className="rounded-md border border-border p-3">{issue.description}</p>

        {!issue.cylinder_removed && issue.severity === "bloke" && (
          <Button variant="outline" disabled={busy} onClick={releaseMachine}>
            Silindir makineden çıkarıldı — makineyi serbest bırak
          </Button>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <p className="mb-1 text-xs uppercase text-muted-foreground">İlgili operasyonlar</p>
            <div className="space-y-1">
              {(detail.data?.ops ?? []).map((o: any) => (
                <div key={o.id} className="flex flex-wrap gap-2">
                  <span className="font-medium">{o.stations?.name}</span>
                  <span>{o.op_label}</span>
                  <Badge variant="outline">Tur {o.round_no}</Badge>
                  <Badge variant={o.status === "bloke" ? "destructive" : "secondary"}>
                    {o.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase text-muted-foreground">Ölçümler</p>
            <div className="space-y-1">
              {(detail.data?.meas ?? []).length === 0 && (
                <p className="text-muted-foreground">Ölçüm kaydı yok.</p>
              )}
              {(detail.data?.meas ?? []).map((m: any) => (
                <div key={m.id} className="flex flex-wrap gap-2">
                  <span className="font-medium">{m.station_code}</span>
                  <span>Ç: {formatMm(m.circumference_mm)}</span>
                  <span>Çap: {formatMm(m.diameter_mm)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase text-muted-foreground">Notlar</p>
            <div className="space-y-1">
              {(detail.data?.notes ?? []).map((n: any) => (
                <div key={n.id} className="flex flex-wrap gap-2">
                  <Badge variant={n.kind === "not" ? "secondary" : "destructive"}>
                    {OP_NOTE_LABELS[n.kind as never]}
                  </Badge>
                  <span>{n.body}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {issue.decision && (
          <div className="rounded-md border border-border p-3">
            <p className="font-medium">
              Karar: {QUALITY_DECISION_LABELS[issue.decision as never]} ·{" "}
              {new Date(issue.decided_at).toLocaleString("tr-TR")}
            </p>
            <p className="text-muted-foreground">{issue.decision_reason}</p>
            {issue.decision === "devam" && !issue.resolved_at && canDecide && (
              <Button className="mt-2" disabled={busy} onClick={resume}>
                Akışa devam et (blokeyi kaldır)
              </Button>
            )}
            {issue.decision === "rework" && (
              <p className="mt-2">
                Rework rotası, takım ekranındaki{" "}
                <Link
                  to="/rota/$orderId"
                  params={{ orderId: order?.id ?? "" }}
                  className="underline"
                >
                  rota önizlemesinden
                </Link>{" "}
                hazırlanır.
              </p>
            )}
          </div>
        )}

        {canDecide && !["karar_verildi", "reddedildi"].includes(issue.status) && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="font-medium">Yönetici kararı</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="karar">Karar</Label>
                <select
                  id="karar"
                  className="h-10 w-full rounded-md border border-input bg-background px-3"
                  value={decision}
                  onChange={(e) => setDecision(e.target.value as QualityDecision)}
                >
                  {QUALITY_DECISIONS.map((d) => (
                    <option key={d} value={d}>
                      {QUALITY_DECISION_LABELS[d]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="neden">Değerlendirilen kaynak neden</Label>
                <select
                  id="neden"
                  className="h-10 w-full rounded-md border border-input bg-background px-3"
                  value={cause}
                  onChange={(e) => setCause(e.target.value)}
                >
                  <option value="">Bilinmiyor</option>
                  {(detail.data?.causes ?? []).map((c: any) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sorumluluk">Ticari sorumluluk</Label>
                <select
                  id="sorumluluk"
                  className="h-10 w-full rounded-md border border-input bg-background px-3"
                  value={resp}
                  onChange={(e) => setResp(e.target.value as QualityResponsibility)}
                >
                  {RESPONSIBILITIES.map((r) => (
                    <option key={r} value={r}>
                      {RESPONSIBILITY_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="gerekce">Karar gerekçesi (zorunlu)</Label>
              <Textarea
                id="gerekce"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Talebin reddi blokeyi otomatik kaldırmaz. Bu aşamada fiyat veya fatura üretilmez.
            </p>
            <Button disabled={busy} onClick={decide}>
              Kararı kaydet
            </Button>
          </div>
        )}
        {!canDecide && (
          <p className="text-xs text-muted-foreground">
            Karar verme yetkiniz yok; kayıtları yalnızca görüntülüyorsunuz.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  );
}
