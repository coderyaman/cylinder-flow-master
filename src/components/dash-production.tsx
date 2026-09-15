import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowUpRight, CircleAlert, Info } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ageText,
  dashErrorText,
  minText,
  trDateOnly,
  trTime,
  type DashProduction,
} from "@/lib/dashboard";
import { PRIORITY_LABELS } from "@/lib/kanban";

type KpiProps = {
  label: string;
  value: number | string;
  hint?: string;
  to?: string;
  search?: Record<string, unknown>;
  tone?: "normal" | "warn" | "bad";
};

const TONE: Record<string, string> = {
  normal: "border-border",
  warn: "border-amber-500/60 bg-amber-500/5",
  bad: "border-destructive/60 bg-destructive/5",
};

function Kpi({ label, value, hint, to, search, tone = "normal" }: KpiProps) {
  const body = (
    <div
      className={`group h-full min-h-28 rounded-xl border bg-card p-4 shadow-sm transition-all ${TONE[tone]} ${
        to ? "hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        {to ? <ArrowUpRight className="size-3.5 text-muted-foreground transition-colors group-hover:text-primary" /> : hint ? <Info className="size-3.5 text-muted-foreground" aria-label={hint} /> : null}
      </div>
      <p className="mt-3 text-3xl font-bold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
  if (!to) return body;
  return (
    <Link to={to} search={search as never} className="block">
      {body}
    </Link>
  );
}

export function DashProductionView() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const query = useQuery({
    queryKey: ["dash-production"],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dash_production");
      if (error) throw new Error(dashErrorText(error.message));
      return data as unknown as DashProduction;
    },
  });

  const d = query.data;

  const chart = useMemo(
    () =>
      (d?.stations ?? []).map((s) => ({
        name: s.name,
        Kuyrukta: s.queued,
        İşlemde: s.in_progress,
        Bloke: s.blocked,
      })),
    [d],
  );

  if (query.isLoading) {
    return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Üretim özeti yükleniyor"><div className="h-28 animate-pulse rounded-xl bg-muted" /><div className="h-28 animate-pulse rounded-xl bg-muted" /><div className="h-28 animate-pulse rounded-xl bg-muted" /></div>;
  }
  if (query.isError || !d) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Veri alınamadı</CardTitle>
          <CardDescription>{(query.error as Error)?.message ?? "Bilinmeyen hata."}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const k = d.kpi;
  const buckets = {
    gecikti: d.deadlines.filter((x) => x.bucket === "gecikti"),
    bugun: d.deadlines.filter((x) => x.bucket === "bugun"),
    yaklasan: d.deadlines.filter((x) => x.bucket === "yaklasan"),
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-3">
        <div className="min-w-0"><h2 className="text-sm font-semibold text-foreground">Anlık üretim durumu</h2><p className="mt-1 text-xs text-muted-foreground">Aktif siparişler, fiziksel üretim ve termin görünümü</p></div>
        <p className="text-xs text-muted-foreground sm:text-right">
          Son güncellenme: {trTime(d.generated_at)} · Türkiye saati
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Aktif sipariş" value={k.active_orders} hint="Sevk veya iptal olmamış" to="/siparisler" />
        <Kpi
          label="Üretimdeki fiziksel silindir"
          value={k.wip_cylinders}
          hint="Kuyruk + işlem + bloke"
          to="/uretim"
        />
        <Kpi label="Bugün tamamlanan operasyon" value={k.ops_today} hint="Tamamlanma tarihine göre" />
        <Kpi
          label="Blokeli silindir"
          value={k.blocked_cylinders}
          hint="Bloke veya karar bekliyor"
          tone={k.blocked_cylinders > 0 ? "bad" : "normal"}
          to="/uretim"
          search={{ bloke: true }}
        />
        <Kpi
          label="Geciken sipariş"
          value={k.overdue_orders}
          tone={k.overdue_orders > 0 ? "bad" : "normal"}
          to="/uretim"
          search={{ geciken: true }}
        />
        <Kpi
          label="Bugün terminli sipariş"
          value={k.due_today_orders}
          tone={k.due_today_orders > 0 ? "warn" : "normal"}
        />
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Üretim hareketi</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Planlanan imalat" value={k.planned_manufacture} hint="Fiziksel silindir değil" to="/uretim" />
        <Kpi label="Bugün depoya giren" value={k.received_today} hint="Silindir" to="/depo" />
        <Kpi label="Bugün işlenen tekil silindir" value={k.cyl_today} hint="Dönem toplamı" />
        <Kpi label="Bu hafta işlenen tekil silindir" value={k.cyl_week} hint="Dönem toplamı" />
        <Kpi label="Bu ay işlenen tekil silindir" value={k.cyl_month} hint="Dönem toplamı" />
        <Kpi
          label="Çalışan / aktif makine"
          value={`${k.machines_busy} / ${k.machines_active}`}
          hint="Şu an operasyonu olan makineler"
        />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">İstasyon yoğunluğu</CardTitle>
            <CardDescription>Kuyrukta, işlemde ve bloke adetleri (anlık).</CardDescription>
          </CardHeader>
          <CardContent>
            {chart.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aktif istasyon yok.</p>
            ) : (
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} height={50} textAnchor="end" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                     <Bar dataKey="Kuyrukta" stackId="a" fill="var(--chart-1)" radius={[3,3,0,0]} />
                     <Bar dataKey="İşlemde" stackId="a" fill="var(--chart-2)" radius={[3,3,0,0]} />
                     <Bar dataKey="Bloke" stackId="a" fill="var(--destructive)" radius={[3,3,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <Table className="mt-3">
              <TableHeader>
                <TableRow>
                  <TableHead>İstasyon</TableHead>
                  <TableHead className="text-right">Kuyrukta</TableHead>
                  <TableHead className="text-right">İşlemde</TableHead>
                  <TableHead className="text-right">Bloke</TableHead>
                  <TableHead className="text-right">Açık kuyruk yaşı (ort.)</TableHead>
                  <TableHead className="text-right">İşlem süresi (7 gün ort.)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.stations.map((s) => (
                  <TableRow key={s.station_id}>
                    <TableCell>
                      <Link to="/uretim" search={{ istasyon: s.code } as never} className="underline-offset-2 hover:underline">
                        {s.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.queued}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.in_progress}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.blocked}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {minText(s.avg_queue_min)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {s.ops_7d > 0 ? minText(s.avg_op_min_7d) : "Veri eksik"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              İşlem süresi bitiş − başlangıçtır; operatörün net emek süresi değildir. Açık kuyruk yaşı
              henüz başlamamış işlerin bekleme süresidir.
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Makineler</CardTitle>
            <CardDescription>
              Duruş ve takvim verisi olmadığı için çalışma yüzdesi hesaplanmaz.
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[420px] overflow-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Makine</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead className="text-right">Bugün</TableHead>
                  <TableHead className="text-right">Bu hafta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.machines.map((m) => (
                  <TableRow key={m.machine_id}>
                    <TableCell>
                      <p className="font-medium">{m.name}</p>
                      <p className="text-xs text-muted-foreground">{m.station}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.busy ? "default" : "outline"}>
                        {m.busy ? "Çalışıyor" : "Boşta"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {m.ops_today} iş · {minText(m.minutes_today)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {m.ops_week} iş · {minText(m.minutes_week)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="p-3 text-[11px] text-muted-foreground">
              Boş süre ve verimlilik: Veri eksik (duruş kaydı yok).
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Bekleyen işler ve bekleme süreleri</CardTitle>
            <CardDescription>
              Kuyrukta bekleyen {d.waiting.length} iş · en uzun bekleyen üstte.
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[360px] overflow-auto p-0">
            {d.waiting.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Kuyrukta bekleyen iş yok.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Firma / iş emri</TableHead>
                    <TableHead>Silindir</TableHead>
                    <TableHead>İstasyon</TableHead>
                    <TableHead className="text-right">Bekleme</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.waiting.map((w) => (
                    <TableRow key={w.step_id}>
                      <TableCell>
                        <p className="font-medium">{w.customer}</p>
                        <p className="text-xs text-muted-foreground">
                          {w.work_order_no} · {w.order_name}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {w.cyl_code ?? `Planlanan imalat · ${w.team_code}`}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Link to="/uretim" search={{ istasyon: w.station_code } as never} className="underline-offset-2 hover:underline">
                          {w.station}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {ageText(w.queued_at, now)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Termin durumu</CardTitle>
            <CardDescription>Geciken / bugün / önümüzdeki 1–3 gün.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(
              [
                ["Geciken", buckets.gecikti, "bad"],
                ["Bugün", buckets.bugun, "warn"],
                ["1–3 gün", buckets.yaklasan, "normal"],
              ] as const
            ).map(([label, list, tone]) => (
              <div key={label} className={`rounded-lg border p-3 ${TONE[tone]}`}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{label}</p>
                  <Badge variant="outline">{list.length} sipariş</Badge>
                </div>
                {list.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">Kayıt yok.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {list.map((o) => (
                      <li key={o.order_id} className="text-xs">
                        <Link
                          to="/siparis/$orderId"
                          params={{ orderId: o.order_id }}
                          className="underline-offset-2 hover:underline"
                        >
                          <span className="font-medium">{o.customer}</span> · {o.work_order_no} ·{" "}
                          {o.order_name}
                        </Link>
                        <span className="text-muted-foreground">
                          {" "}
                          — {trDateOnly(o.due_on)} · {o.active_members} aktif üye
                          {o.blocked_members > 0 ? ` · ${o.blocked_members} blokeli` : ""}
                          {o.priority !== "normal" ? ` · ${PRIORITY_LABELS[o.priority] ?? o.priority}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base"><CircleAlert className="size-4 text-destructive" />Müdahale bekleyen kalite ve rework kararları</CardTitle>
            <CardDescription>{d.quality.length} açık kayıt.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[320px] overflow-auto p-0">
            {d.quality.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Bekleyen karar yok.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sipariş</TableHead>
                    <TableHead>Tespit / neden</TableHead>
                    <TableHead>Sorumluluk</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.quality.map((q) => (
                    <TableRow key={q.issue_id}>
                      <TableCell className="text-xs">
                        <p className="font-medium">{q.customer}</p>
                        <p className="text-muted-foreground">
                          {q.work_order_no} · {q.cyl_code ?? q.team_code}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {q.detected_station} · {q.category ?? "—"}
                        <p className="text-muted-foreground">{q.description}</p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {q.responsibility === "ic_hata"
                          ? "İç hata (ücretsiz)"
                          : q.responsibility === "musteri_revizyonu"
                            ? "Müşteri revizyonu"
                            : "Belirsiz"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to="/kalite"
                          search={{ issue: q.issue_id } as never}
                          className="text-xs underline underline-offset-2"
                        >
                          Kararı incele
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Takımı bekleten üyeler</CardTitle>
            <CardDescription>
              Prova için hazır olmayan {d.team_waiters.length} üye ve açık nedenleri.
            </CardDescription>
          </CardHeader>
          <CardContent className="max-h-[320px] overflow-auto p-0">
            {d.team_waiters.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Takımı bekleten üye yok.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Takım / sipariş</TableHead>
                    <TableHead>Üye</TableHead>
                    <TableHead>Neden</TableHead>
                    <TableHead>Sonraki adım</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.team_waiters.map((w, i) => (
                    <TableRow key={`${w.team_code}-${w.cyl_code ?? i}`}>
                      <TableCell className="text-xs">
                        <Link
                          to="/siparis/$orderId"
                          params={{ orderId: w.order_id }}
                          className="font-medium underline-offset-2 hover:underline"
                        >
                          {w.customer} · {w.work_order_no}
                        </Link>
                        <p className="text-muted-foreground">{w.team_code}</p>
                      </TableCell>
                      <TableCell className="text-xs">
                        {w.cyl_code ?? "Planlanan imalat"}
                        {w.stage_no ? ` · Kademe ${w.stage_no}` : ""}
                      </TableCell>
                      <TableCell className="text-xs">
                        {w.reason}
                        {w.issue_id ? (
                          <>
                            {" "}
                            <Link
                              to="/kalite"
                              search={{ issue: w.issue_id } as never}
                              className="underline underline-offset-2"
                            >
                              Kalite kaydını aç
                            </Link>
                          </>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {w.next_step ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
