import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey } from "@/lib/orders";
import {
  PROOF_RESULTS,
  PROOF_RESULT_HINTS,
  PROOF_RESULT_LABELS,
  proofErrorText,
  mm,
  type ProofGate,
  type ProofResult,
} from "@/lib/proof";
import { proofGraphicLink } from "@/lib/proof-graphics.functions";
import { QrScanner, extractCylCode } from "@/components/qr-scan";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/operator/prova")({
  validateSearch: (search: Record<string, unknown>) => ({
    team: typeof search["team"] === "string" ? (search["team"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Prova ve Son Kontrol — Rotagravür MES" },
      {
        name: "description",
        content:
          "Takım bazlı Prova: hazırlık kapısı, aktif üyeler, makine seçimi ve Prova sonucu tek ekranda.",
      },
      { property: "og:title", content: "Prova ve Son Kontrol — Rotagravür MES" },
      {
        property: "og:description",
        content: "Takımın Prova hazırlığını görün, Prova'yı başlatın ve sonucu kaydedin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProofScreen,
});

function ProofScreen() {
  const { team } = Route.useSearch();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canStart = hasPermission("operation.start");
  const canComplete = hasPermission("operation.complete");
  const queryClient = useQueryClient();
  const [scanOpen, setScanOpen] = useState(false);

  const teamsQuery = useQuery({
    queryKey: ["proof-teams"],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select(
          "id, team_code, proof_queued_at, shipment_ready_at, blocked_at, created_at, orders!inner(work_order_no, name, quantity, due_on, closure_status, customers(name))",
        )
        .eq("orders.closure_status", "acik")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const teams = teamsQuery.data ?? [];
  const selected = team ?? null;

  function select(id: string | undefined) {
    void navigate({ to: "/operator/prova", search: { team: id } });
  }

  async function openByCode(raw: string) {
    const code = extractCylCode(raw) ?? raw.trim().toUpperCase();
    const { data, error } = await supabase
      .from("team_members")
      .select("team_id, cylinder_receipts!inner(cyl_code)")
      .eq("is_active", true)
      .eq("cylinder_receipts.cyl_code", code)
      .maybeSingle();
    if (error || !data) {
      toast.error("Bu koda ait aktif takım üyesi bulunamadı.");
      return;
    }
    setScanOpen(false);
    select(data.team_id);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Prova ve Son Kontrol</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prova tek takım operasyonudur. QR okutmak Prova'yı başlatmaz; makineyi seçip Başlat'a
          basmanız gerekir. Prova onayı sevkiyat kaydı oluşturmaz.
        </p>
        <Link to="/operator" className="mt-2 inline-block text-sm underline">
          Operatör ekranına dön
        </Link>
      </div>

      <Button size="lg" className="h-16 w-full text-lg" onClick={() => setScanOpen(true)}>
        QR Oku / Kod Gir (üyenin kodu takımı açar)
      </Button>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Takımlar ({teams.length})</CardTitle>
          <CardDescription>Açık siparişlere ait takımlar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {teamsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">Açık siparişe ait takım yok.</p>
          ) : (
            teams.map((t: any) => (
              <button
                key={t.id}
                type="button"
                onClick={() => select(t.id)}
                className={`block w-full rounded-lg border p-4 text-left transition-colors hover:bg-accent ${
                  t.id === selected ? "border-primary bg-accent" : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{t.team_code}</span>
                  {t.shipment_ready_at && <Badge>Sevkiyata Hazır</Badge>}
                  {t.blocked_at && <Badge variant="destructive">Takım bloke</Badge>}
                  {t.proof_queued_at && !t.shipment_ready_at && (
                    <Badge variant="secondary">Prova kuyruğunda</Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t.orders?.customers?.name} · {t.orders?.work_order_no} · {t.orders?.name} ·{" "}
                  {t.orders?.quantity} adet
                </p>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {selected && (
        <TeamProof
          teamId={selected}
          canStart={canStart}
          canComplete={canComplete}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ["proof-teams"] });
          }}
        />
      )}

      <Sheet open={scanOpen} onOpenChange={setScanOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>QR okut veya kod gir</SheetTitle>
            <SheetDescription>
              Aktif bir üyenin kodu takımını açar; ayrı takım QR'si gerekmez.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            <QrScanner onCode={(c) => void openByCode(c)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TeamProof({
  teamId,
  canStart,
  canComplete,
  onChanged,
}: {
  teamId: string;
  canStart: boolean;
  canComplete: boolean;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [machineId, setMachineId] = useState("");
  const [busy, setBusy] = useState(false);
  const [startKey, setStartKey] = useState(() => newIdempotencyKey());
  const [completeKey, setCompleteKey] = useState(() => newIdempotencyKey());
  const [result, setResult] = useState<ProofResult | "">("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const gateQuery = useQuery({
    queryKey: ["proof-gate", teamId],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("proof_gate", { _team_id: teamId });
      if (error) throw error;
      return data as unknown as ProofGate;
    },
  });

  const machinesQuery = useQuery({
    queryKey: ["proof-machines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("machines")
        .select("id, code, name, stations!inner(code)")
        .eq("is_active", true)
        .eq("stations.code", "PROVA")
        .order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const categoriesQuery = useQuery({
    queryKey: ["defect-categories-proof"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("defect_categories")
        .select("code, label")
        .eq("is_active", true)
        .eq("assessed_cause_only", false)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const runQuery = useQuery({
    queryKey: ["proof-runs", teamId],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proof_runs")
        .select("*, machines(name)")
        .eq("team_id", teamId)
        .order("round_no", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const gate = gateQuery.data;
  const machines = machinesQuery.data ?? [];
  const runs = runQuery.data ?? [];
  const activeRun = runs.find((r: any) => r.status === "devam") ?? null;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["proof-gate", teamId] });
    void queryClient.invalidateQueries({ queryKey: ["proof-runs", teamId] });
    onChanged();
  }

  async function openPdf() {
    const tab = window.open("", "_blank");
    try {
      const res = await proofGraphicLink({ data: { teamId } });
      if (tab) tab.location.href = res.url;
      toast.success(`Revizyon ${res.revisionNo} açıldı.`);
    } catch (e: any) {
      tab?.close();
      toast.error(proofErrorText(e.message ?? "Grafik dosyası açılamadı."));
    }
  }

  async function start() {
    if (!machineId) {
      toast.error("Prova makinesini seçin.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("proof_start", {
      _team_id: teamId,
      _machine_id: machineId,
      _idempotency_key: startKey,
    });
    setBusy(false);
    if (error) {
      toast.error(proofErrorText(error.message));
      return;
    }
    setStartKey(newIdempotencyKey());
    toast.success("Prova başlatıldı.");
    refresh();
  }

  async function complete() {
    if (!result) {
      toast.error("Sonuç zorunludur.");
      return;
    }
    if (result !== "onaylandi" && (!note.trim() || !category)) {
      toast.error("Hata kategorisi ve açıklama zorunludur.");
      return;
    }
    if (result === "silindir_duzeltilecek" && picked.length === 0) {
      toast.error("En az bir aktif üye seçilmelidir.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("proof_complete", {
      _run_id: activeRun.id,
      _result: result,
      _note: note.trim() || undefined,
      _category_code: result === "onaylandi" ? undefined : category,
      _member_ids: result === "silindir_duzeltilecek" ? picked : [],
      _idempotency_key: completeKey,
    });
    setBusy(false);
    if (error) {
      toast.error(proofErrorText(error.message));
      return;
    }
    const res = data as any;
    setCompleteKey(newIdempotencyKey());
    setResult("");
    setNote("");
    setCategory("");
    setPicked([]);
    toast.success(
      res?.shipment_ready
        ? "Onaylandı — takım Sevkiyata Hazır. Sevkiyat kaydı oluşmadı."
        : res?.issues_created > 0
          ? `Sonuç kaydedildi; ${res.issues_created} üye Müdür kararına düştü.`
          : "Sonuç kaydedildi.",
    );
    refresh();
  }

  if (gateQuery.isLoading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (gateQuery.error)
    return (
      <p className="text-sm text-destructive">
        Takım bilgisi okunamadı: {(gateQuery.error as Error).message}
      </p>
    );
  if (!gate) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {gate.team_code} — {gate.customer}
          </CardTitle>
          <CardDescription>
            {gate.work_order_no} · {gate.order_name} · {gate.quantity} adet ·{" "}
            {gate.due_on ? `Termin ${new Date(gate.due_on).toLocaleDateString("tr-TR")}` : "Termin yok"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {gate.critical_note && (
            <p className="text-sm font-medium text-destructive">{gate.critical_note}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {gate.shipment_ready_at && gate.approval_valid && <Badge>Sevkiyata Hazır</Badge>}
            {gate.shipment_ready_at && !gate.approval_valid && (
              <Badge variant="destructive">
                Onay geçersiz — takım veya üretim bağlamı değişti
              </Badge>
            )}
            <Badge variant="outline">
              Fiziksel üye {gate.physical_members}/{gate.quantity}
            </Badge>
          </div>
          <Button type="button" variant="outline" onClick={() => void openPdf()}>
            Grafik PDF'ini Aç
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Aktif Üyeler (kademe sırası)</CardTitle>
          <CardDescription>
            Planlanan imalatlar ve değiştirilmiş eski üyeler hazır sayılmaz.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1 text-left">Kademe</th>
                <th className="py-1 text-left">Silindir</th>
                <th className="py-1 text-left">Çevre</th>
                <th className="py-1 text-left">Çap</th>
                <th className="py-1 text-left">Boy</th>
                <th className="py-1 text-left">Durum</th>
              </tr>
            </thead>
            <tbody>
              {gate.members.map((m) => (
                <tr key={m.member_id} className="border-b border-border/60">
                  <td className="py-1.5 tabular-nums">{m.stage_no ?? "—"}</td>
                  <td className="py-1.5 font-mono">{m.cyl_code ?? "Planlanan imalat"}</td>
                  <td className="py-1.5">
                    {m.measurements_recorded ? mm(m.circumference_mm) : "Ölçüm kaydı yok"}
                  </td>
                  <td className="py-1.5">
                    {m.measurements_recorded ? mm(m.diameter_mm) : "—"}
                  </td>
                  <td className="py-1.5">{m.measurements_recorded ? mm(m.length_mm) : "—"}</td>
                  <td className="py-1.5">
                    {m.proof_ready_at ? (
                      <Badge variant="secondary">Prova İçin Hazır</Badge>
                    ) : (
                      <Badge variant="outline">Hazır değil</Badge>
                    )}
                    {m.open_warnings > 0 && (
                      <Badge variant="outline" className="ml-1">
                        {m.open_warnings} uyarı
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {gate.warnings.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Uyarılar</CardTitle>
            <CardDescription>Uyarı otomatik bloke değildir; Prova'yı engellemez.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {gate.warnings.map((w, i) => (
              <p key={i} className="text-sm">
                {w.text}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {!activeRun && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Prova Başlat</CardTitle>
            <CardDescription>
              Başlangıç, bitiş, operatör ve makine takım operasyonunda kaydedilir.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {gate.blockers.length > 0 ? (
              <div className="space-y-1 rounded-lg border border-destructive/40 p-3">
                <p className="text-sm font-medium text-destructive">Prova başlatılamaz:</p>
                {gate.blockers.map((b, i) => (
                  <p key={i} className="text-sm">
                    • {b.text}
                  </p>
                ))}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Prova makinesi</Label>
                  <div className="flex flex-wrap gap-2">
                    {machines.map((m: any) => (
                      <Button
                        key={m.id}
                        type="button"
                        size="lg"
                        variant={m.id === machineId ? "default" : "outline"}
                        onClick={() => setMachineId(m.id)}
                      >
                        {m.name}
                      </Button>
                    ))}
                    {machines.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Prova istasyonunda tanımlı makine yok.
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  size="lg"
                  className="h-14 w-full text-lg"
                  disabled={!canStart || busy || !machineId}
                  onClick={() => void start()}
                >
                  Başlat
                </Button>
                {!canStart && (
                  <p className="text-xs text-muted-foreground">Başlatma yetkiniz yok.</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {activeRun && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Devam Eden Prova — Tur {activeRun.round_no}
            </CardTitle>
            <CardDescription>
              {activeRun.machines?.name} · Başlangıç{" "}
              {new Date(activeRun.started_at).toLocaleString("tr-TR")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Sonuç</Label>
              {PROOF_RESULTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResult(r)}
                  className={`block w-full rounded-lg border p-3 text-left ${
                    result === r ? "border-primary bg-accent" : "border-border"
                  }`}
                >
                  <span className="text-sm font-medium">{PROOF_RESULT_LABELS[r]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {PROOF_RESULT_HINTS[r]}
                  </span>
                </button>
              ))}
            </div>

            {result && result !== "onaylandi" && (
              <>
                <div className="space-y-1.5">
                  <Label>Hata kategorisi</Label>
                  <div className="flex flex-wrap gap-2">
                    {(categoriesQuery.data ?? []).map((c: any) => (
                      <Button
                        key={c.code}
                        type="button"
                        variant={category === c.code ? "default" : "outline"}
                        onClick={() => setCategory(c.code)}
                      >
                        {c.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="prova-aciklama">Açıklama</Label>
                  <Textarea
                    id="prova-aciklama"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                  />
                </div>
              </>
            )}

            {result === "silindir_duzeltilecek" && (
              <div className="space-y-2">
                <Label>Problemli aktif üyeler</Label>
                {gate.members
                  .filter((m) => m.receipt_id)
                  .map((m) => (
                    <label
                      key={m.member_id}
                      className="flex items-center gap-3 rounded-lg border border-border p-3"
                    >
                      <Checkbox
                        checked={picked.includes(m.member_id)}
                        onCheckedChange={(v) =>
                          setPicked((prev) =>
                            v ? [...prev, m.member_id] : prev.filter((x) => x !== m.member_id),
                          )
                        }
                      />
                      <span className="text-sm">
                        Kademe {m.stage_no ?? "—"} ·{" "}
                        <span className="font-mono">{m.cyl_code}</span>
                      </span>
                    </label>
                  ))}
              </div>
            )}

            {result === "takim_yeniden" && (
              <p className="text-sm text-muted-foreground">
                Güncel aktif üyelerin tamamı ({gate.active_members}) etki kapsamına alınır; takım
                bloke edilir ve Müdür kararı beklenir.
              </p>
            )}

            {result === "onaylandi" && (
              <p className="text-sm text-muted-foreground">
                Onay yalnızca bu ekranda görünen üyelik ve üretim bağlamı için geçerlidir. Sonraki
                değişiklikler onayı geçersiz kılar.
              </p>
            )}

            <Button
              type="button"
              size="lg"
              className="h-14 w-full text-lg"
              disabled={!canComplete || busy || !result}
              onClick={() => void complete()}
            >
              Tamamla
            </Button>
            {!canComplete && (
              <p className="text-xs text-muted-foreground">Tamamlama yetkiniz yok.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Prova Turları ({runs.length})</CardTitle>
          <CardDescription>Önceki turlar ve kararlar silinmez.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz Prova yapılmadı.</p>
          ) : (
            runs.map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="tabular-nums">Tur {r.round_no}</span>
                <Badge variant={r.result === "onaylandi" ? "secondary" : "outline"}>
                  {r.status === "devam"
                    ? "Devam ediyor"
                    : PROOF_RESULT_LABELS[r.result as ProofResult]}
                </Badge>
                <span className="text-muted-foreground">{r.machines?.name}</span>
                {r.note && <span className="text-muted-foreground">· {r.note}</span>}
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {new Date(r.started_at).toLocaleString("tr-TR")}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
