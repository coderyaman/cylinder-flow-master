import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey } from "@/lib/orders";
import { elapsedText } from "@/lib/operations";
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
import { Input } from "@/components/ui/input";
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

function dateText(v: string | null | undefined) {
  return v ? new Date(v).toLocaleDateString("tr-TR") : "—";
}
function timeText(v: string | null | undefined) {
  return v
    ? new Date(v).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })
    : "—";
}

/** Prova operatör ekranı. Prova takımın tamamı için tek operasyondur. */
export function ProofOperator({
  teamId,
  onSelect,
}: {
  teamId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { userId, hasPermission } = useAuth();
  const canStart = hasPermission("operation.start");
  const canComplete = hasPermission("operation.complete");
  const queryClient = useQueryClient();
  const [scanOpen, setScanOpen] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const teamsQuery = useQuery({
    queryKey: ["proof-teams"],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, team_code, created_at, orders!inner(closure_status)")
        .eq("orders.closure_status", "acik")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const teamIds = useMemo(
    () => (teamsQuery.data ?? []).map((t: any) => t.id as string),
    [teamsQuery.data],
  );

  const gateResults = useQueries({
    queries: teamIds.map((id) => ({
      queryKey: ["proof-gate", id],
      refetchInterval: 60000,
      queryFn: async () => {
        const { data, error } = await supabase.rpc("proof_gate", { _team_id: id });
        if (error) throw error;
        return data as unknown as ProofGate;
      },
    })),
  });

  const gates = gateResults
    .map((r) => r.data)
    .filter((g): g is ProofGate => !!g && !g.shipment_ready_at);
  const gatesLoading = gateResults.some((r) => r.isLoading);

  const runsQuery = useQuery({
    queryKey: ["proof-active-runs"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proof_runs")
        .select("*, machines(code, name), teams(team_code, orders(work_order_no, name))")
        .eq("status", "devam")
        .order("started_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const todayQuery = useQuery({
    queryKey: ["proof-today", userId],
    enabled: !!userId,
    refetchInterval: 60000,
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("proof_runs")
        .select("*, machines(name), teams(team_code, orders(work_order_no, name))")
        .eq("status", "tamamlandi")
        .gte("finished_at", start.toISOString())
        .order("finished_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const issuesQuery = useQuery({
    queryKey: ["proof-pending-issues"],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quality_issues")
        .select(
          "id, status, description, requested_at, category_code, proof_run_id, team_members(team_id, stage_no, teams(team_code), cylinder_receipts(cyl_code))",
        )
        .not("proof_run_id", "is", null)
        .in("status", ["acik", "bilgi_bekleniyor"])
        .order("requested_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const machinesQuery = useQuery({
    queryKey: ["proof-machines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("machines")
        .select("id, code, name, is_active, stations!inner(code)")
        .eq("stations.code", "PROVA")
        .order("code");
      if (error) throw error;
      return data ?? [];
    },
  });

  const runs = runsQuery.data ?? [];
  const operatorIds = useMemo(
    () =>
      Array.from(
        new Set(
          [...runs, ...(todayQuery.data ?? [])]
            .map((r: any) => r.started_by as string | null)
            .filter((x): x is string => !!x),
        ),
      ),
    [runs, todayQuery.data],
  );

  const profilesQuery = useQuery({
    queryKey: ["proof-profiles", operatorIds.join(",")],
    enabled: operatorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", operatorIds);
      if (error) throw error;
      return data ?? [];
    },
  });
  const nameOf = (id: string | null) =>
    (profilesQuery.data ?? []).find((p: any) => p.id === id)?.full_name ?? "—";

  const activeTeamIds = new Set(runs.map((r: any) => r.team_id as string));
  const myRuns = runs.filter((r: any) => r.started_by === userId);
  const queue = gates.filter((g) => g.ready && !activeTeamIds.has(g.team_id));
  const waiting = gates.filter((g) => !g.ready && !activeTeamIds.has(g.team_id));

  function refreshAll() {
    void queryClient.invalidateQueries({ queryKey: ["proof-teams"] });
    void queryClient.invalidateQueries({ queryKey: ["proof-gate"] });
    void queryClient.invalidateQueries({ queryKey: ["proof-active-runs"] });
    void queryClient.invalidateQueries({ queryKey: ["proof-today"] });
    void queryClient.invalidateQueries({ queryKey: ["proof-pending-issues"] });
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
    setCodeInput("");
    onSelect(data.team_id);
  }

  if (teamId) {
    return (
      <TeamProof
        teamId={teamId}
        canStart={canStart}
        canComplete={canComplete}
        onBack={() => onSelect(null)}
        onChanged={refreshAll}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Prova — Operatör Ekranı
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Prova takımın tamamı için tek operasyondur: tek Başlat, tek Tamamla. QR okutmak
            Prova'yı başlatmaz.
          </p>
        </div>
        <Button type="button" onClick={() => setScanOpen(true)}>
          QR Oku / Kod Gir
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Aktif Provalarım ({myRuns.length})</CardTitle>
          <CardDescription>Yürüttüğünüz takım Prova operasyonları.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {myRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">Devam eden Prova'nız yok.</p>
          ) : (
            myRuns.map((r: any) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r.team_id)}
                className="block w-full rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">
                    {r.teams?.orders?.work_order_no} · {r.teams?.orders?.name}
                  </span>
                  <Badge variant="outline">{r.teams?.team_code}</Badge>
                  <Badge variant="secondary">{r.machines?.name}</Badge>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {elapsedText(r.started_at, now)}
                  </span>
                </div>
              </button>
            ))
          )}
          {runs.length > myRuns.length && (
            <p className="text-xs text-muted-foreground">
              Diğer operatörlerin {runs.length - myRuns.length} aktif Prova'sı makine
              listesinde görünür.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Prova Kuyruğu ({queue.length})</CardTitle>
          <CardDescription>Hazırlık koşullarını karşılayan takımlar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {teamsQuery.isLoading || gatesLoading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Prova'ya hazır takım yok.</p>
          ) : (
            queue.map((g) => <TeamRow key={g.team_id} g={g} now={now} onSelect={onSelect} />)
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Karar Bekleyenler ({issuesQuery.data?.length ?? 0})</CardTitle>
          <CardDescription>Prova kaynaklı, Müdür kararı bekleyen kayıtlar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(issuesQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Karar bekleyen Prova kaydı yok.</p>
          ) : (
            (issuesQuery.data ?? []).map((q: any) => (
              <button
                key={q.id}
                type="button"
                onClick={() => onSelect(q.team_members?.team_id ?? null)}
                className="block w-full rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">
                    {q.team_members?.cylinder_receipts?.cyl_code ?? "Planlanan imalat"}
                  </span>
                  <Badge variant="outline">{q.team_members?.teams?.team_code}</Badge>
                  <Badge variant="destructive">Müdür kararı bekliyor</Badge>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {elapsedText(q.requested_at, now)}
                  </span>
                </div>
                <p className="text-muted-foreground">{q.description}</p>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Bugün Tamamladıklarım ({(todayQuery.data ?? []).filter((r: any) => r.finished_by === userId).length})
          </CardTitle>
          <CardDescription>Bugün kapatılan Prova turları.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {(todayQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Bugün tamamlanan Prova yok.</p>
          ) : (
            (todayQuery.data ?? []).map((r: any) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{r.teams?.orders?.work_order_no}</span>
                <Badge variant="outline">{r.teams?.team_code}</Badge>
                <Badge variant={r.result === "onaylandi" ? "secondary" : "destructive"}>
                  {PROOF_RESULT_LABELS[r.result as ProofResult]}
                </Badge>
                <span className="text-muted-foreground">Tur {r.round_no}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {timeText(r.started_at)} → {timeText(r.finished_at)}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Prova Makineleri</CardTitle>
          <CardDescription>Makinede devam eden takım, operatör ve süre.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {(machinesQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Prova istasyonunda tanımlı makine yok.</p>
          ) : (
            (machinesQuery.data ?? []).map((m: any) => {
              const run = runs.find((r: any) => r.machine_id === m.id);
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{m.name}</span>
                  {!m.is_active && <Badge variant="destructive">Pasif / arızalı</Badge>}
                  {run ? (
                    <>
                      <Badge variant="secondary">{run.teams?.team_code}</Badge>
                      <span className="text-muted-foreground">{nameOf(run.started_by)}</span>
                      <span className="ml-auto tabular-nums text-muted-foreground">
                        {timeText(run.started_at)} · {elapsedText(run.started_at, now)}
                      </span>
                    </>
                  ) : (
                    <span className="ml-auto text-muted-foreground">Boşta</span>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Hazırlık Bekleyenler ({waiting.length})</CardTitle>
          <CardDescription>Henüz Prova koşullarını karşılamayan takımlar.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {waiting.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bekleyen takım yok.</p>
          ) : (
            waiting.map((g) => (
              <TeamRow key={g.team_id} g={g} now={now} onSelect={onSelect} showBlockers />
            ))
          )}
        </CardContent>
      </Card>

      <Sheet open={scanOpen} onOpenChange={setScanOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>QR okut veya kod gir</SheetTitle>
            <SheetDescription>
              Aktif bir üyenin kodu takımını açar; okutmak Prova'yı başlatmaz.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            <QrScanner onCode={(c) => void openByCode(c)} />
            <div className="space-y-1.5">
              <Label htmlFor="prova-kod">CYL kodu</Label>
              <div className="flex gap-2">
                <Input
                  id="prova-kod"
                  className="h-12 text-base"
                  placeholder="CYL-2026-00001"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void openByCode(codeInput);
                  }}
                />
                <Button type="button" onClick={() => void openByCode(codeInput)}>
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

function TeamRow({
  g,
  now,
  onSelect,
  showBlockers,
}: {
  g: ProofGate;
  now: number;
  onSelect: (id: string) => void;
  showBlockers?: boolean;
}) {
  const ready = g.members.filter((m) => m.proof_ready_at).length;
  return (
    <button
      type="button"
      onClick={() => onSelect(g.team_id)}
      className="block w-full rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-accent"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
        <span>{g.customer}</span>
        <span className="text-muted-foreground">·</span>
        <span>{g.work_order_no}</span>
        <span className="text-muted-foreground">·</span>
        <span className="truncate">{g.order_name}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">{g.team_code}</span>
        <span>{g.quantity} silindir</span>
        <span>Hazır {ready}/{g.quantity}</span>
        <span>Termin {dateText(g.due_on)}</span>
        {g.priority !== "normal" && (
          <Badge variant="destructive" className="h-5">
            {g.priority === "acil" ? "Acil" : "Yüksek"}
          </Badge>
        )}
        <span className="ml-auto tabular-nums">
          {g.shipment_ready_at
            ? "Sevkiyata Hazır"
            : g.members[0]?.proof_ready_at
              ? `${elapsedText(g.members[0].proof_ready_at, now)} bekliyor`
              : ""}
        </span>
      </div>
      {showBlockers && g.blockers.length > 0 && (
        <p className="mt-1 text-xs text-destructive">
          {g.blockers.map((b) => b.text).join(" · ")}
        </p>
      )}
    </button>
  );
}

function TeamProof({
  teamId,
  canStart,
  canComplete,
  onBack,
  onChanged,
}: {
  teamId: string;
  canStart: boolean;
  canComplete: boolean;
  onBack: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [machineId, setMachineId] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [startKey, setStartKey] = useState(() => newIdempotencyKey());
  const [completeKey, setCompleteKey] = useState(() => newIdempotencyKey());
  const [result, setResult] = useState<ProofResult | "">("");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

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
    queryKey: ["proof-machines-active"],
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
    if (!activeRun) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("proof_complete", {
      _run_id: activeRun.id as string,
      _result: result,
      ...(note.trim() ? { _note: note.trim() } : {}),
      ...(result === "onaylandi" ? {} : { _category_code: category }),
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
      res?.replayed
        ? "Bu sonuç zaten kaydedilmişti; ikinci kayıt oluşturulmadı."
        : res?.shipment_ready
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
      <div className="space-y-3">
        <Button type="button" variant="outline" onClick={onBack}>
          ← Prova ekranına dön
        </Button>
        <p className="text-sm text-destructive">
          Takım bilgisi okunamadı: {(gateQuery.error as Error).message}
        </p>
      </div>
    );
  if (!gate) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Button type="button" variant="outline" size="sm" onClick={onBack}>
        ← Prova ekranına dön
      </Button>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {gate.customer} · {gate.work_order_no}
          </CardTitle>
          <CardDescription>
            {gate.order_name} · <span className="font-mono">{gate.team_code}</span> ·{" "}
            {gate.quantity} adet · Termin {dateText(gate.due_on)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {gate.critical_note && (
            <p className="text-sm font-medium text-destructive">{gate.critical_note}</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {gate.shipment_ready_at && gate.approval_valid && <Badge>Sevkiyata Hazır</Badge>}
            {gate.shipment_ready_at && !gate.approval_valid && (
              <Badge variant="destructive">Onay geçersiz — takım veya üretim bağlamı değişti</Badge>
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
          <CardTitle className="text-base">Aktif Silindirler (kademe sırası)</CardTitle>
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
                  <td className="py-1.5">{m.measurements_recorded ? mm(m.diameter_mm) : "—"}</td>
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
            <CardTitle className="text-base">Provayı Başlat</CardTitle>
            <CardDescription>
              Takımın tamamı için tek operasyon; başlangıç, bitiş, operatör ve makine kaydedilir.
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
                        variant={m.id === machineId ? "default" : "outline"}
                        onClick={() => setMachineId(m.id)}
                      >
                        {m.name}
                      </Button>
                    ))}
                    {machines.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Prova istasyonunda tanımlı aktif makine yok.
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  className="h-12 w-full text-base"
                  disabled={!canStart || busy || !machineId}
                  onClick={() => void start()}
                >
                  Provayı Başlat
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
            <CardTitle className="text-base">Devam Eden Prova — Tur {activeRun.round_no}</CardTitle>
            <CardDescription>
              {activeRun.machines?.name} · Başlangıç{" "}
              {new Date(activeRun.started_at).toLocaleString("tr-TR")} ·{" "}
              {elapsedText(activeRun.started_at, now)}
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
              className="h-12 w-full text-base"
              disabled={!canComplete || busy || !result}
              onClick={() => void complete()}
            >
              Provayı Tamamla
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
                  {timeText(r.started_at)}
                  {r.finished_at ? ` → ${timeText(r.finished_at)}` : ""}
                </span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
