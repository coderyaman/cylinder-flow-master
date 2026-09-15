import { createFileRoute, Link } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PLANNED_OP_LABELS, type PlannedOp } from "@/lib/teams";
import {
  HOLD_LABELS,
  MEMBER_STATE_LABELS,
  PRIORITY_LABELS,
  RISK_CLASS,
  RISK_LABEL,
  dueDays,
  identText,
  kanbanErrorText,
  riskOf,
  waitText,
  type KanbanBoard,
  type KanbanCard,
  type KanbanColumn,
  type KanbanTeamCard,
  type OrderDetail,
} from "@/lib/kanban";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/uretim")({
  head: () => ({
    meta: [
      { title: "Üretim Kanbanı — Rotagravür MES" },
      {
        name: "description",
        content:
          "İstasyon sırasına göre işlemde, kuyrukta ve bloke işler; Prova sütununda takım kartları ve sipariş bazlı canlı dağılım.",
      },
      { property: "og:title", content: "Üretim Kanbanı — Rotagravür MES" },
      {
        property: "og:description",
        content: "İşlerin nerede olduğunu ve hangi siparişin neden beklediğini tek ekranda görün.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: KanbanScreen,
});

const ALL = "__hepsi";

function cardIsBlocked(c: KanbanCard) {
  return c.hold !== null;
}

function KanbanScreen() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("team.manage");
  const queryClient = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [q, setQ] = useState("");
  const [station, setStation] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [machine, setMachine] = useState(ALL);
  const [operator, setOperator] = useState(ALL);
  const [late, setLate] = useState(false);
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [reworkOnly, setReworkOnly] = useState(false);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [card, setCard] = useState<KanbanCard | null>(null);
  const [team, setTeam] = useState<KanbanTeamCard | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const boardQuery = useQuery({
    queryKey: ["kanban-board"],
    refetchInterval: 15000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("kanban_board");
      if (error) throw error;
      return data as unknown as KanbanBoard;
    },
  });

  const orderQuery = useQuery({
    queryKey: ["kanban-order", orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("kanban_order_detail", { _order_id: orderId! });
      if (error) throw error;
      return data as unknown as OrderDetail;
    },
  });

  const reorder = useMutation({
    mutationFn: async (input: { stationId: string; stepIds: string[] }) => {
      const { error } = await supabase.rpc("queue_reorder", {
        _station_id: input.stationId,
        _step_ids: input.stepIds,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Kuyruk sırası güncellendi. Operatör ekranı da bu sırayı kullanır.");
      queryClient.invalidateQueries({ queryKey: ["kanban-board"] });
      queryClient.invalidateQueries({ queryKey: ["op-queue"] });
      queryClient.invalidateQueries({ queryKey: ["kuyruk"] });
    },
    onError: (e: any) => toast.error(kanbanErrorText(e.message ?? String(e))),
  });

  const columns = useMemo(() => boardQuery.data?.columns ?? [], [boardQuery.data]);

  const machines = useMemo(() => {
    const set = new Set<string>();
    for (const c of columns)
      for (const x of c.in_progress as KanbanCard[]) if (x.machine) set.add(x.machine);
    return [...set].sort();
  }, [columns]);

  const operators = useMemo(() => {
    const set = new Set<string>();
    for (const c of columns)
      for (const x of c.in_progress as KanbanCard[]) if (x.operator) set.add(x.operator);
    return [...set].sort();
  }, [columns]);

  const term = q.trim().toLocaleLowerCase("tr");

  function matches(c: KanbanCard): boolean {
    if (term) {
      const hay = [c.customer, c.work_order_no, c.order_name, c.cyl_code ?? "", c.team_code]
        .join(" ")
        .toLocaleLowerCase("tr");
      if (!hay.includes(term)) return false;
    }
    if (priority !== ALL && c.priority !== priority) return false;
    if (machine !== ALL && c.machine !== machine) return false;
    if (operator !== ALL && c.operator !== operator) return false;
    const d = dueDays(c.due_on);
    if (late && !(d !== null && d < 0)) return false;
    if (blockedOnly && !cardIsBlocked(c)) return false;
    if (reworkOnly && !c.rework_round) return false;
    if (criticalOnly) {
      const critical =
        (d !== null && d <= 2) || cardIsBlocked(c) || c.warnings > 0 || c.priority === "acil";
      if (!critical) return false;
    }
    return true;
  }

  function matchesTeam(t: KanbanTeamCard): boolean {
    if (term) {
      const hay = [t.customer, t.work_order_no, t.order_name, t.team_code]
        .join(" ")
        .toLocaleLowerCase("tr");
      if (!hay.includes(term)) return false;
    }
    if (priority !== ALL && t.priority !== priority) return false;
    if (machine !== ALL && t.machine !== machine) return false;
    if (operator !== ALL && t.operator !== operator) return false;
    const d = dueDays(t.due_on);
    if (late && !(d !== null && d < 0)) return false;
    const blocked = !!t.blocked_at || t.pending_decisions.length > 0;
    if (blockedOnly && !blocked) return false;
    if (reworkOnly && (t.round_no ?? 1) <= 1) return false;
    if (criticalOnly) {
      const critical = (d !== null && d <= 2) || blocked || t.priority === "acil";
      if (!critical) return false;
    }
    return true;
  }

  const visible = columns.filter((c) => station === ALL || c.code === station);
  const filtering =
    !!term ||
    priority !== ALL ||
    machine !== ALL ||
    operator !== ALL ||
    late ||
    blockedOnly ||
    reworkOnly ||
    criticalOnly;

  function move(col: KanbanColumn, stepId: string, dir: -1 | 1) {
    const ids = (col.queued as KanbanCard[]).map((x) => x.step_id!).filter(Boolean);
    const i = ids.indexOf(stepId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const a = ids[i] as string;
    const b = ids[j] as string;
    ids[i] = b;
    ids[j] = a;
    reorder.mutate({ stationId: col.station_id!, stepIds: ids });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Üretim Kanbanı</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pano mevcut rota, kuyruk ve operasyon kayıtlarından beslenir. Henüz sırası gelmemiş planlı
          adımlar kuyrukta gösterilmez. Sevk edilmiş işler panoda yer almaz;{" "}
          <Link to="/arsiv" className="underline">
            arşivden
          </Link>{" "}
          erişilir.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-3">
        <div className="w-64">
          <Label className="text-xs">Ara</Label>
          <Input
            placeholder="Firma, iş emri, iş adı, CYL"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="w-44">
          <Label className="text-xs">İstasyon</Label>
          <Select value={station} onValueChange={setStation}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tümü</SelectItem>
              {columns.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Label className="text-xs">Öncelik</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tümü</SelectItem>
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Label className="text-xs">Makine</Label>
          <Select value={machine} onValueChange={setMachine}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tümü</SelectItem>
              {machines.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Label className="text-xs">Operatör</Label>
          <Select value={operator} onValueChange={setOperator}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tümü</SelectItem>
              {operators.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={late ? "default" : "outline"} size="sm" onClick={() => setLate(!late)}>
            Geciken
          </Button>
          <Button
            variant={blockedOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setBlockedOnly(!blockedOnly)}
          >
            Bloke / karar
          </Button>
          <Button
            variant={reworkOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setReworkOnly(!reworkOnly)}
          >
            Rework
          </Button>
          <Button
            variant={criticalOnly ? "destructive" : "outline"}
            size="sm"
            onClick={() => setCriticalOnly(!criticalOnly)}
          >
            Kritik İşler
          </Button>
        </div>
      </div>

      {boardQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
      ) : boardQuery.isError ? (
        <p className="text-sm text-destructive">
          Pano verisi alınamadı. Bağlantınızı kontrol edip sayfayı yenileyin.
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {visible.map((col) =>
            col.team_column ? (
              <ProofColumn
                key={col.code}
                col={col}
                now={now}
                filter={matchesTeam}
                filtering={filtering}
                onSelect={(t) => setTeam(t)}
              />
            ) : (
              <StationColumn
                key={col.code}
                col={col}
                now={now}
                filter={matches}
                filtering={filtering}
                canManage={canManage}
                onSelect={setCard}
                onMove={(id, dir) => move(col, id, dir)}
              />
            ),
          )}
        </div>
      )}

      <CardSheet
        card={card}
        now={now}
        onClose={() => setCard(null)}
        onOrder={(id) => {
          setCard(null);
          setOrderId(id);
        }}
      />
      <TeamSheet
        team={team}
        now={now}
        onClose={() => setTeam(null)}
        onOrder={(id) => {
          setTeam(null);
          setOrderId(id);
        }}
      />
      <OrderSheet
        orderId={orderId}
        detail={orderQuery.data ?? null}
        loading={orderQuery.isLoading}
        error={orderQuery.isError}
        now={now}
        onClose={() => setOrderId(null)}
      />
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} ({count})
      </p>
      {children}
    </div>
  );
}

function StationColumn({
  col,
  now,
  filter,
  canManage,
  onSelect,
  onMove,
}: {
  col: KanbanColumn;
  now: number;
  filter: (c: KanbanCard) => boolean;
  canManage: boolean;
  onSelect: (c: KanbanCard) => void;
  onMove: (stepId: string, dir: -1 | 1) => void;
}) {
  const inProgress = (col.in_progress as KanbanCard[]).filter(filter);
  const queued = (col.queued as KanbanCard[]).filter(filter);
  const blocked = (col.blocked as KanbanCard[]).filter(filter);
  const empty = inProgress.length + queued.length + blocked.length === 0;

  return (
    <section className="w-72 shrink-0 space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <h2 className="text-sm font-bold text-foreground">{col.name}</h2>
      {empty ? (
        <p className="text-xs text-muted-foreground">Filtreye uyan iş yok.</p>
      ) : (
        <>
          <Section title="İşlemde" count={inProgress.length}>
            {inProgress.map((c) => (
              <CylinderCard key={c.operation_id} c={c} now={now} onSelect={onSelect} />
            ))}
          </Section>
          <Section title="Kuyrukta" count={queued.length}>
            {queued.map((c, i) => (
              <div key={c.step_id} className="flex items-start gap-1">
                <div className="flex-1">
                  <CylinderCard c={c} now={now} onSelect={onSelect} rank={i + 1} />
                </div>
                {canManage && (
                  <div className="flex flex-col gap-1 pt-1">
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      aria-label="Sırada yukarı taşı"
                      onClick={() => onMove(c.step_id!, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      aria-label="Sırada aşağı taşı"
                      onClick={() => onMove(c.step_id!, 1)}
                    >
                      ↓
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </Section>
          <Section title="Bloke / Karar Bekliyor" count={blocked.length}>
            {blocked.map((c) => (
              <CylinderCard key={c.operation_id} c={c} now={now} onSelect={onSelect} />
            ))}
          </Section>
        </>
      )}
    </section>
  );
}

function CylinderCard({
  c,
  now,
  onSelect,
  rank,
}: {
  c: KanbanCard;
  now: number;
  onSelect: (c: KanbanCard) => void;
  rank?: number;
}) {
  const risk = riskOf(c.due_on, c.hold !== null);
  return (
    <button
      type="button"
      onClick={() => onSelect(c)}
      className={`mb-2 w-full rounded-md border p-2 text-left ${RISK_CLASS[risk]}`}
    >
      <div className="flex flex-wrap items-center gap-1">
        {rank && <span className="text-xs tabular-nums text-muted-foreground">{rank}.</span>}
        <span className="font-mono text-sm">{identText(c)}</span>
        {c.stage_no !== null && <Badge variant="outline">Kademe {c.stage_no}</Badge>}
        {!c.cyl_code && <Badge variant="secondary">Planlanan</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {c.customer} · {c.work_order_no}
      </p>
      <p className="text-xs">{c.op_label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
        {c.priority === "acil" && <Badge variant="destructive">Acil</Badge>}
        {c.priority === "yuksek" && <Badge variant="outline">Yüksek</Badge>}
        {RISK_LABEL[risk] && risk !== "bloke" && <Badge variant="outline">{RISK_LABEL[risk]}</Badge>}
        {c.hold && <Badge variant="destructive">{HOLD_LABELS[c.hold]}</Badge>}
        {c.machine_held && <Badge variant="outline">Makine bağlı</Badge>}
        {c.rework_round && <Badge variant="outline">Rework tur {c.rework_round}</Badge>}
        {c.warnings > 0 && <Badge variant="outline">⚠ {c.warnings} uyarı</Badge>}
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {c.machine ? `${c.machine} · ${c.operator ?? "—"} · ` : ""}
        {waitText(c.since, now)}
        {c.operation_id ? " çalışıyor" : " bekliyor"}
        {c.due_on ? ` · Termin ${new Date(c.due_on).toLocaleDateString("tr-TR")}` : ""}
      </p>
    </button>
  );
}

function ProofColumn({
  col,
  now,
  filter,
  onSelect,
}: {
  col: KanbanColumn;
  now: number;
  filter: (t: KanbanTeamCard) => boolean;
  onSelect: (t: KanbanTeamCard) => void;
}) {
  const running = (col.in_progress as KanbanTeamCard[]).filter(filter);
  const queued = (col.queued as KanbanTeamCard[]).filter(filter);
  const blocked = (col.blocked as KanbanTeamCard[]).filter(filter);
  const prep = (col.preparing ?? []).filter(filter);
  const ship = (col.ready_to_ship ?? []).filter(filter);
  const empty = running.length + queued.length + blocked.length + prep.length + ship.length === 0;

  return (
    <section className="w-80 shrink-0 space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <h2 className="text-sm font-bold text-foreground">Prova (takım)</h2>
      <p className="text-xs text-muted-foreground">
        Prova takım operasyonudur; silindir sayısı takım sayısıyla toplanmaz.
      </p>
      {empty ? (
        <p className="text-xs text-muted-foreground">Filtreye uyan takım yok.</p>
      ) : (
        <>
          <Section title="Provada" count={running.length}>
            {running.map((t) => (
              <TeamCard key={t.team_id} t={t} now={now} onSelect={onSelect} />
            ))}
          </Section>
          <Section title="Prova Kuyruğu" count={queued.length}>
            {queued.map((t) => (
              <TeamCard key={t.team_id} t={t} now={now} onSelect={onSelect} />
            ))}
          </Section>
          <Section title="Bloke / Karar Bekliyor" count={blocked.length}>
            {blocked.map((t) => (
              <TeamCard key={t.team_id} t={t} now={now} onSelect={onSelect} />
            ))}
          </Section>
          <Section title="Hazırlık Bekleyenler" count={prep.length}>
            {prep.map((t) => (
              <TeamCard key={t.team_id} t={t} now={now} onSelect={onSelect} />
            ))}
          </Section>
          <Section title="Sevkiyata Hazır" count={ship.length}>
            {ship.map((t) => (
              <TeamCard key={t.team_id} t={t} now={now} onSelect={onSelect} />
            ))}
          </Section>
        </>
      )}
    </section>
  );
}

function TeamCard({
  t,
  now,
  onSelect,
}: {
  t: KanbanTeamCard;
  now: number;
  onSelect: (t: KanbanTeamCard) => void;
}) {
  const blocked = !!t.blocked_at || t.pending_decisions.length > 0;
  const risk = riskOf(t.due_on, blocked);
  return (
    <button
      type="button"
      onClick={() => onSelect(t)}
      className={`mb-2 w-full rounded-md border p-2 text-left ${RISK_CLASS[risk]}`}
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-mono text-sm">{t.team_code}</span>
        <Badge variant="outline">1 takım</Badge>
        <Badge variant="secondary">{t.active_members} silindir</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t.customer} · {t.work_order_no} · {t.order_name}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
        <Badge variant="outline">
          {t.ready_members}/{t.active_members} hazır
        </Badge>
        {t.priority === "acil" && <Badge variant="destructive">Acil</Badge>}
        {RISK_LABEL[risk] && risk !== "bloke" && <Badge variant="outline">{RISK_LABEL[risk]}</Badge>}
        {blocked && <Badge variant="destructive">Karar bekliyor</Badge>}
        {t.active_run_id && <Badge>Provada · Tur {t.round_no}</Badge>}
      </div>
      {t.active_run_id && (
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          {t.machine ?? "—"} · {t.operator ?? "—"} · {waitText(t.started_at ?? null, now)}
        </p>
      )}
      {!t.active_run_id && t.blockers[0] && (
        <p className="mt-1 text-xs text-muted-foreground">{t.blockers[0].text}</p>
      )}
    </button>
  );
}

function CardSheet({
  card,
  now,
  onClose,
  onOrder,
}: {
  card: KanbanCard | null;
  now: number;
  onClose: () => void;
  onOrder: (orderId: string) => void;
}) {
  return (
    <Sheet open={!!card} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {card && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono">{identText(card)}</SheetTitle>
              <SheetDescription>
                {card.customer} · {card.work_order_no} · {card.order_name}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-2 text-sm">
              <Row k="İşlem" v={card.op_label} />
              <Row k="Takım" v={card.team_code} />
              <Row k="Kademe" v={card.stage_no === null ? "Atanmadı" : String(card.stage_no)} />
              <Row
                k="Termin"
                v={card.due_on ? new Date(card.due_on).toLocaleDateString("tr-TR") : "—"}
              />
              <Row k="Öncelik" v={PRIORITY_LABELS[card.priority] ?? card.priority} />
              <Row
                k={card.operation_id ? "Geçen süre" : "Bekleme"}
                v={waitText(card.since, now)}
              />
              {card.machine && <Row k="Makine" v={card.machine} />}
              {card.operator && <Row k="Operatör" v={card.operator} />}
              {card.rework_round && <Row k="Rework turu" v={String(card.rework_round)} />}
              {card.planned_ops && card.planned_ops.length > 0 && (
                <Row
                  k="Planlanan ek işler"
                  v={card.planned_ops
                    .map((o) => PLANNED_OP_LABELS[o as PlannedOp] ?? o)
                    .join(", ")}
                />
              )}
              {card.hold && <Row k="Durum" v={HOLD_LABELS[card.hold] ?? card.hold} />}
              {card.note && <Row k="Not" v={card.note} />}
              {card.critical_note && (
                <p className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">
                  {card.critical_note}
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => onOrder(card.order_id)}>
                Sipariş görünümü
              </Button>
              {card.operation_id && (
                <Link
                  to="/operator/aktif/$operationId"
                  params={{ operationId: card.operation_id }}
                  className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
                >
                  Operasyonu aç
                </Link>
              )}
              {card.step_id && (
                <Link
                  to="/operator/is/$stepId"
                  params={{ stepId: card.step_id }}
                  search={{ qr: undefined }}
                  className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
                >
                  Kuyruktaki işi aç
                </Link>
              )}
              {card.issue_id && (
                <Link
                  to="/kalite"
                  search={{ issue: card.issue_id }}
                  className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
                >
                  Kalite kaydını aç
                </Link>
              )}
              <Link
                to="/rota/$orderId"
                params={{ orderId: card.order_id }}
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
              >
                Rota ekranı
              </Link>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Kart taşımak rota atlatmaz ve operasyon tamamlamaz; bunlar ilgili ekranlardan yapılır.
            </p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function TeamSheet({
  team,
  now,
  onClose,
  onOrder,
}: {
  team: KanbanTeamCard | null;
  now: number;
  onClose: () => void;
  onOrder: (orderId: string) => void;
}) {
  return (
    <Sheet open={!!team} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {team && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono">{team.team_code}</SheetTitle>
              <SheetDescription>
                {team.customer} · {team.work_order_no} · {team.order_name}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-2 text-sm">
              <Row k="Takım" v="1 takım (tek Prova operasyonu)" />
              <Row k="Silindir" v={`${team.active_members} aktif üye`} />
              <Row k="Hazırlık" v={`${team.ready_members}/${team.active_members} hazır`} />
              <Row k="Sipariş adedi" v={String(team.quantity)} />
              <Row
                k="Termin"
                v={team.due_on ? new Date(team.due_on).toLocaleDateString("tr-TR") : "—"}
              />
              {team.active_run_id && (
                <>
                  <Row k="Makine" v={team.machine ?? "—"} />
                  <Row k="Operatör" v={team.operator ?? "—"} />
                  <Row k="Geçen süre" v={waitText(team.started_at ?? null, now)} />
                </>
              )}
              {team.blocked_reason && <Row k="Bloke nedeni" v={team.blocked_reason} />}
            </div>
            {team.blockers.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium">Eksikler</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {team.blockers.map((b, i) => (
                    <li key={i}>{b.text}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => onOrder(team.order_id)}>
                Sipariş görünümü
              </Button>
              <Link
                to="/operator/prova"
                search={{ team: team.team_id }}
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
              >
                Prova ekranı
              </Link>
              {team.pending_decisions[0] && (
                <Link
                  to="/kalite"
                  search={{ issue: team.pending_decisions[0].issue_id }}
                  className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
                >
                  Kararı incele
                </Link>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function OrderSheet({
  orderId,
  detail,
  loading,
  error,
  now,
  onClose,
}: {
  orderId: string | null;
  detail: OrderDetail | null;
  loading: boolean;
  error: boolean;
  now: number;
  onClose: () => void;
}) {
  const dist = useMemo(() => {
    if (!detail) return [] as { label: string; count: number }[];
    const map = new Map<string, number>();
    for (const m of detail.members) {
      const key =
        m.state === "planlanan"
          ? "Planlanan imalat"
          : m.station
            ? `${m.station} (${MEMBER_STATE_LABELS[m.state] ?? m.state})`
            : (MEMBER_STATE_LABELS[m.state] ?? m.state);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].map(([label, count]) => ({ label, count }));
  }, [detail]);

  return (
    <Sheet open={!!orderId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {loading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : error ? (
          <p className="text-sm text-destructive">Sipariş görünümü alınamadı.</p>
        ) : (
          detail && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {detail.customer} · {detail.work_order_no}
                </SheetTitle>
                <SheetDescription>
                  {detail.order_name} · {detail.quantity} adet ·{" "}
                  {detail.due_on
                    ? `Termin ${new Date(detail.due_on).toLocaleDateString("tr-TR")}`
                    : "Termin —"}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4">
                <p className="text-sm font-medium">Güncel dağılım</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {dist.length === 0
                    ? "Aktif üye yok."
                    : dist.map((d) => `${d.count} ${d.label}`).join(", ")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tamamlanma yüzdesi veya tahmini bitiş verilmez.
                </p>
              </div>

              <div className="mt-4 space-y-2">
                {detail.members.map((m) => {
                  const problem =
                    m.state === "bloke" ||
                    m.state === "uretime_alinmadi" ||
                    m.state === "planlanan" ||
                    !!m.issue_id ||
                    !!m.team_blocked_at;
                  return (
                    <div
                      key={m.member_id}
                      className={`rounded-md border p-2 text-sm ${
                        problem ? "border-destructive bg-destructive/5" : "border-border"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono">
                          {m.cyl_code ?? `Planlanan imalat · ${m.team_code}`}
                        </span>
                        {m.stage_no !== null && (
                          <Badge variant="outline">Kademe {m.stage_no}</Badge>
                        )}
                        <Badge variant={problem ? "destructive" : "secondary"}>
                          {MEMBER_STATE_LABELS[m.state] ?? m.state}
                        </Badge>
                        {m.station && <span className="text-muted-foreground">{m.station}</span>}
                      </div>
                      {m.open_op && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {m.open_op.op_label} · {m.open_op.machine ?? "—"} ·{" "}
                          {m.open_op.operator ?? "—"} · {waitText(m.open_op.started_at, now)}
                        </p>
                      )}
                      {m.next_step && !m.open_op && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Sıradaki: {m.next_step.op_label}
                          {m.next_step.status === "kuyrukta"
                            ? ` · ${waitText(m.next_step.queued_at, now)} bekliyor`
                            : " · henüz kuyrukta değil"}
                        </p>
                      )}
                      {m.issue_id && (
                        <Link
                          to="/kalite"
                          search={{ issue: m.issue_id }}
                          className="mt-1 inline-block text-xs underline"
                        >
                          Kalite kaydını aç
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>

              {detail.historical.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm font-medium">Tarihsel üyeler (değiştirilmiş)</p>
                  <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                    {detail.historical.map((h) => (
                      <li key={h.member_id}>
                        <span className="font-mono">{h.cyl_code ?? "Planlanan üye"}</span> ·{" "}
                        {h.removed_reason ?? "Takımdan çıkarıldı"}
                        {h.removed_at
                          ? ` · ${new Date(h.removed_at).toLocaleDateString("tr-TR")}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to="/siparis/$orderId"
                  params={{ orderId: detail.order_id }}
                  className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
                >
                  Sipariş detayı
                </Link>
                <Link
                  to="/rota/$orderId"
                  params={{ orderId: detail.order_id }}
                  className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm"
                >
                  Rota ekranı
                </Link>
              </div>
            </>
          )
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
