import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PLANNED_OP_LABELS, type PlannedOp } from "@/lib/teams";
import { elapsedText } from "@/lib/operations";
import { QrScanner, extractCylCode } from "@/components/qr-scan";
import { ProofOperator } from "@/components/proof-operator";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/operator/")({
  head: () => ({
    meta: [
      { title: "Operatör Ekranı — Operon" },
      {
        name: "description",
        content:
          "Seçili istasyonun aktif işleri, kuyruğu, blokeli işleri ve bugün tamamlananları tek dokunmatik ekranda.",
      },
      { property: "og:title", content: "Operatör Ekranı — Operon" },
      {
        property: "og:description",
        content: "İstasyon bağlamında sade operatör akışı: QR oku, makine seç, başlat, tamamla.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OperatorHome,
});

const MEMBER_SELECT =
  "kind, planned_ops, cylinder_receipts(cyl_code), teams(team_code, orders(work_order_no, name, priority, critical_note, due_on, customers(name)))";

const STATION_KEY = "operator.station";

function jobInfo(m: any) {
  const o = m?.teams?.orders;
  return {
    customer: o?.customers?.name ?? "—",
    workOrder: o?.work_order_no ?? "—",
    job: o?.name ?? "",
    priority: o?.priority ?? "normal",
    critical: o?.critical_note ?? "",
    due: o?.due_on ?? null,
    ident: m?.cylinder_receipts?.cyl_code ?? `Planlanan imalat · ${m?.teams?.team_code ?? ""}`,
    ops: (m?.planned_ops ?? []) as PlannedOp[],
  };
}

function OperatorHome() {
  const { userId, stationIds, hasRole, hasPermission } = useAuth();
  const isAdmin = hasRole("admin");
  const canStart = hasPermission("operation.start");
  const navigate = useNavigate();
  const [scanOpen, setScanOpen] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [stationId, setStationId] = useState<string | null>(null);
  const [proofTeam, setProofTeam] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const stationsQuery = useQuery({
    queryKey: ["op-stations", isAdmin, stationIds.join(",")],
    queryFn: async () => {
      let q = supabase
        .from("stations")
        .select("id, code, name, sort_order")
        .eq("is_active", true)
        .order("sort_order");
      if (!isAdmin) q = q.in("id", stationIds.length > 0 ? stationIds : ["00000000-0000-0000-0000-000000000000"]);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const stations = useMemo(() => stationsQuery.data ?? [], [stationsQuery.data]);

  useEffect(() => {
    if (stations.length === 0) return;
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(STATION_KEY) : null;
    setStationId((current) => {
      if (current && stations.some((s: any) => s.id === current)) return current;
      if (stored && stations.some((s: any) => s.id === stored)) return stored;
      return (stations[0] as any).id as string;
    });
  }, [stations]);

  useEffect(() => {
    if (stationId && typeof window !== "undefined")
      window.localStorage.setItem(STATION_KEY, stationId);
  }, [stationId]);

  const station = stations.find((s: any) => s.id === stationId) ?? null;
  const stationName = station?.name ?? "";

  const activeQuery = useQuery({
    queryKey: ["op-active", userId, stationId],
    refetchInterval: 30000,
    enabled: !!userId && !!stationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operations")
        .select(`*, stations(id, code, name), machines(code, name), team_members(${MEMBER_SELECT})`)
        .eq("started_by", userId!)
        .eq("status", "devam")
        .order("started_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const blockedQuery = useQuery({
    queryKey: ["op-blocked", stationId],
    refetchInterval: 60000,
    enabled: !!stationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operations")
        .select(`*, stations(code, name), team_members(${MEMBER_SELECT})`)
        .eq("status", "bloke")
        .eq("station_id", stationId!)
        .order("finished_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const queueQuery = useQuery({
    queryKey: ["op-queue", stationId],
    refetchInterval: 30000,
    enabled: !!stationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("route_steps")
        .select(
          `id, op_label, queued_at, queue_rank, station_id, stations(code, name, sort_order), route_plans(team_members(${MEMBER_SELECT}))`,
        )
        .eq("status", "kuyrukta")
        .eq("station_id", stationId!)
        // Pano'da verilen sıra ile aynı kaynak: önce queue_rank, sonra kuyruğa giriş.
        .order("queue_rank", { ascending: true, nullsFirst: false })
        .order("queued_at");
      if (error) throw error;
      const { data: started, error: e2 } = await supabase
        .from("operations")
        .select("route_step_id");
      if (e2) throw e2;
      const busy = new Set((started ?? []).map((o) => o.route_step_id));
      return (data ?? []).filter((s: any) => !busy.has(s.id));
    },
  });

  const otherQueueQuery = useQuery({
    queryKey: ["op-queue-other"],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("route_steps")
        .select(
          "id, station_id, stations(code, name), route_plans(team_members(cylinder_receipts(cyl_code)))",
        )
        .eq("status", "kuyrukta");
      if (error) throw error;
      return data ?? [];
    },
  });

  const todayQuery = useQuery({
    queryKey: ["op-today", userId, stationId],
    enabled: !!userId && !!stationId,
    queryFn: async () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from("operations")
        .select(`id, op_label, finished_at, result, stations(name), team_members(${MEMBER_SELECT})`)
        .eq("finished_by", userId!)
        .eq("station_id", stationId!)
        .gte("finished_at", start.toISOString())
        .order("finished_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const allActive = activeQuery.data ?? [];
  const active = allActive.filter((op: any) => op.station_id === stationId);
  const otherActive = allActive.filter((op: any) => op.station_id !== stationId);
  const queue = queueQuery.data ?? [];
  const blocked = blockedQuery.data ?? [];
  const today = todayQuery.data ?? [];

  function openByCode(raw: string) {
    const code = extractCylCode(raw) ?? raw.trim().toUpperCase();
    const step = queue.find(
      (s: any) => s.route_plans?.team_members?.cylinder_receipts?.cyl_code === code,
    );
    if (step) {
      setScanOpen(false);
      navigate({ to: "/operator/is/$stepId", params: { stepId: step.id }, search: { qr: code } });
      return;
    }
    const elsewhere = (otherQueueQuery.data ?? []).find(
      (s: any) => s.route_plans?.team_members?.cylinder_receipts?.cyl_code === code,
    );
    if (!elsewhere) {
      toast.error("Bu koda ait bekleyen bir iş bulunamadı.");
      return;
    }
    const target = stations.find((s: any) => s.id === elsewhere.station_id);
    if (target) {
      toast.info(`Bu iş ${target.name} istasyonunda bekliyor. İstasyon değiştirildi.`);
      setStationId(target.id);
      setScanOpen(false);
      return;
    }
    toast.error(
      `Bu iş ${elsewhere.stations?.name ?? "başka bir"} istasyonunda bekliyor; o istasyonda yetkiniz yok.`,
    );
  }

  if (stationsQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  }

  if (stations.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Operatör Ekranı</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Size tanımlı istasyon yok. Yöneticinizden istasyon yetkisi isteyin.
        </p>
      </div>
    );
  }

  if ((station as any)?.code === "PROVA") {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {stations.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {stations.map((s: any) => (
              <Button
                key={s.id}
                type="button"
                variant={s.id === stationId ? "default" : "outline"}
                onClick={() => {
                  setProofTeam(null);
                  setStationId(s.id);
                }}
              >
                {s.name}
              </Button>
            ))}
          </div>
        )}
        <ProofOperator teamId={proofTeam} onSelect={setProofTeam} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {stationName} — Operatör Ekranı
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bu ekrandaki tüm listeler yalnızca {stationName} istasyonuna aittir. QR okutmak süreyi
          başlatmaz; makineyi seçip Başlat'a basmanız gerekir.
        </p>
        {isAdmin && (
          <Link to="/kuyruk" className="mt-2 inline-block text-sm underline">
            Yönetim ekranına dön
          </Link>
        )}
      </div>

      {stations.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {stations.map((s: any) => (
            <Button
              key={s.id}
              type="button"
              size="lg"
              variant={s.id === stationId ? "default" : "outline"}
              onClick={() => setStationId(s.id)}
            >
              {s.name}
            </Button>
          ))}
        </div>
      )}

      {otherActive.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          Diğer istasyonda aktif işiniz var:{" "}
          {otherActive.map((op: any, i: number) => (
            <span key={op.id}>
              {i > 0 && ", "}
              <Link
                to="/operator/aktif/$operationId"
                params={{ operationId: op.id }}
                className="underline"
              >
                {op.stations?.name}
              </Link>
            </span>
          ))}
        </div>
      )}

      <Button size="lg" className="h-16 w-full text-lg" onClick={() => setScanOpen(true)}>
        QR Oku / Kod Gir
      </Button>


      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Aktif İşlerim ({active.length})</CardTitle>
          <CardDescription>
            {stationName} istasyonunda yürüttüğünüz işler.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {activeQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : active.length === 0 ? (
            <p className="text-sm text-muted-foreground">Devam eden işiniz yok.</p>
          ) : (
            active.map((op: any) => {
              const info = jobInfo(op.team_members);
              return (
                <Link
                  key={op.id}
                  to="/operator/aktif/$operationId"
                  params={{ operationId: op.id }}
                  className="block rounded-lg border border-border p-4 transition-colors hover:bg-accent"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{info.ident}</span>
                    <Badge variant="outline">{op.machines?.name}</Badge>
                    <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                      {elapsedText(op.started_at, now)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {info.customer} · {info.workOrder} · {info.job}
                  </p>
                  <p className="text-sm">{op.op_label}</p>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {stationName} Kuyruğu ({queue.length})
          </CardTitle>
          <CardDescription>
            En üstteki iş sıradaki önerilen iştir. Aşağıdaki bir işi alırsanız kısa gerekçe
            istenir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {queueQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Kuyrukta bekleyen iş yok.</p>
          ) : (
            queue.map((s: any, i: number) => {
              const info = jobInfo(s.route_plans?.team_members);
              return (
                <Link
                  key={s.id}
                  to="/operator/is/$stepId"
                  params={{ stepId: s.id }}
                  search={{ qr: undefined }}
                  className="block rounded-lg border border-border p-4 transition-colors hover:bg-accent"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {i === 0 && <Badge>Sıradaki önerilen</Badge>}
                    <span className="font-mono text-sm">{info.ident}</span>
                    {info.priority !== "normal" && (
                      <Badge variant="destructive">
                        {info.priority === "acil" ? "Acil" : "Yüksek"}
                      </Badge>
                    )}
                    <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                      {s.queued_at ? elapsedText(s.queued_at, now) : "—"} bekliyor
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {info.customer} · {info.workOrder} · {info.job}
                  </p>
                  <p className="text-sm">{s.op_label}</p>
                  {info.ops.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Ek işler: {info.ops.map((o) => PLANNED_OP_LABELS[o]).join(", ")}
                    </p>
                  )}
                  {info.critical && (
                    <p className="mt-1 text-xs font-medium text-destructive">{info.critical}</p>
                  )}
                </Link>
              );
            })
          )}
          {!canStart && (
            <p className="text-xs text-muted-foreground">
              Başlatma yetkiniz yok; işleri yalnızca görüntüleyebilirsiniz.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Blokeli / Karar Bekleyen İşler ({blocked.length})
          </CardTitle>
          <CardDescription>
            Bloke iş tamamlanmış sayılmaz ve sonraki kuyruğa geçmez.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {blocked.length === 0 ? (
            <p className="text-sm text-muted-foreground">Blokeli iş yok.</p>
          ) : (
            blocked.map((op: any) => {
              const info = jobInfo(op.team_members);
              return (
                <div key={op.id} className="rounded-lg border border-destructive/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{info.ident}</span>
                    <Badge variant="destructive">Bloke</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {info.customer} · {info.workOrder} · {info.job}
                  </p>
                  {op.note && <p className="text-sm">{op.note}</p>}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Bugün Yaptıklarım ({today.length})</CardTitle>
          <CardDescription>Sade sayım ve saatler; puanlama yoktur.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {today.length === 0 ? (
            <p className="text-sm text-muted-foreground">Bugün tamamladığınız iş yok.</p>
          ) : (
            today.map((op: any) => {
              const info = jobInfo(op.team_members);
              return (
                <div key={op.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono">{info.ident}</span>
                  <span>{op.op_label}</span>
                  <Badge variant={op.result === "basarili" ? "secondary" : "destructive"}>
                    {op.result === "basarili" ? "Başarılı" : "Sorunlu"}
                  </Badge>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {op.finished_at
                      ? new Date(op.finished_at).toLocaleTimeString("tr-TR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </span>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Sheet open={scanOpen} onOpenChange={setScanOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>QR okut veya kod gir</SheetTitle>
            <SheetDescription>
              Okutmak işi yalnızca açar; süre Başlat'a basınca işler.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            <QrScanner onCode={openByCode} />
            <div className="space-y-1.5">
              <Label htmlFor="op-kod">CYL kodu</Label>
              <div className="flex gap-2">
                <Input
                  id="op-kod"
                  className="h-12 text-base"
                  placeholder="CYL-2026-00001"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") openByCode(codeInput);
                  }}
                />
                <Button type="button" size="lg" onClick={() => openByCode(codeInput)}>
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
