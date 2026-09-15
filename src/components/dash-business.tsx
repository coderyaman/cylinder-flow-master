import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  dashErrorText,
  isoDay,
  minText,
  periodRange,
  trDateOnly,
  trTime,
  type DashBusiness,
  type PeriodKey,
} from "@/lib/dashboard";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "bugun", label: "Bugün" },
  { key: "hafta", label: "Bu hafta" },
  { key: "ay", label: "Bu ay" },
  { key: "ozel", label: "Özel tarih" },
];

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function DashBusinessView() {
  const [period, setPeriod] = useState<PeriodKey>("ay");
  const initial = periodRange("ay");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(isoDay(new Date()));

  const range = period === "ozel" ? { from, to } : periodRange(period);

  const query = useQuery({
    queryKey: ["dash-business", range.from, range.to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dash_business", {
        _from: range.from,
        _to: range.to,
      });
      if (error) throw new Error(dashErrorText(error.message));
      return data as unknown as DashBusiness;
    },
  });

  const d = query.data;
  const chart = useMemo(
    () => (d?.stations ?? []).map((s) => ({ name: s.name, Operasyon: s.operations })),
    [d],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1">
          {PERIODS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={period === p.key ? "default" : "outline"}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {period === "ozel" ? (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Başlangıç</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Bitiş</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
            </div>
          </div>
        ) : null}
        <p className="ml-auto text-xs text-muted-foreground">
          Dönem: {trDateOnly(range.from)} – {trDateOnly(range.to)} (Türkiye saati)
          {d ? ` · Son güncellenme: ${trTime(d.generated_at)}` : ""}
        </p>
      </div>

      {query.isLoading ? <p className="text-sm text-muted-foreground">Özet yükleniyor…</p> : null}

      {query.isError ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Veri alınamadı</CardTitle>
            <CardDescription>{(query.error as Error).message}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {d ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
            <Stat
              label="Tamamlanan sipariş"
              value={d.totals.completed_orders}
              hint="Prova onaylı, sevkiyata hazır"
            />
            <Stat label="Sevk edilen sipariş" value={d.totals.shipped_orders} hint="Sevk tarihine göre" />
            <Stat label="Sevk edilen takım" value={d.totals.shipped_teams} />
            <Stat label="Sevk edilen silindir" value={d.totals.shipped_cylinders} />
            <Stat
              label="İşlenen tekil silindir"
              value={d.totals.unique_cylinders}
              hint="Dönemde işi olan farklı CYL"
            />
            <Stat
              label="Tamamlanan operasyon"
              value={d.totals.completed_operations}
              hint={`Prova: ${d.totals.proof_runs} takım turu ayrı`}
            />
            <Stat
              label="Gerçekleşen iş kalemi"
              value={d.totals.work_items}
              hint="Bir operasyonda birden çok iş olabilir"
            />
            <Stat
              label="Prova turu"
              value={d.totals.proof_runs}
              hint={`${d.totals.proof_cylinders} silindir kapsandı`}
            />
            <Stat label="Rework operasyonu" value={d.totals.rework_operations} hint="Olaydan farklı kavram" />
            <Stat label="İç hata rework olayı" value={d.totals.rework_events_internal} hint="Ücretsiz" />
            <Stat
              label="Müşteri revizyonu rework olayı"
              value={d.totals.rework_events_customer}
              hint="Faturalandırılabilir"
            />
            <Stat
              label="Zamanında sevk"
              value={`${d.totals.on_time_shipments} / ${d.totals.shipped_teams}`}
              hint="Termin gününe kadar sevk"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Ticari değerlendirme</CardTitle>
                <CardDescription>
                  Dönemde kapanan siparişlerin muhasebe kalemleri. TL tutarı hesaplanmaz.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                  <span>Faturalandırılabilir</span>
                  <span className="font-bold tabular-nums">{d.billing["faturalandirilabilir"] ?? 0}</span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                  <span>Faturalandırılmayacak</span>
                  <span className="font-bold tabular-nums">
                    {d.billing["faturalandirilmayacak"] ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-md border border-amber-500/60 bg-amber-500/5 p-2 text-sm">
                  <span>Ticari karar bekliyor</span>
                  <span className="font-bold tabular-nums">{d.billing["karar_bekliyor"] ?? 0}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Muhasebe durumu</CardTitle>
                <CardDescription>Tüm açık paketler (dönemden bağımsız anlık durum).</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Link to="/muhasebe" className="block">
                  <div className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-accent">
                    <span>Muhasebe bekleyen</span>
                    <span className="font-bold tabular-nums">{d.accounting.bekliyor}</span>
                  </div>
                </Link>
                <Link to="/muhasebe" className="block">
                  <div className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-accent">
                    <span>İşlenen</span>
                    <span className="font-bold tabular-nums">{d.accounting.islendi}</span>
                  </div>
                </Link>
                <Link to="/muhasebe" className="block">
                  <div className="flex items-center justify-between rounded-md border border-amber-500/60 bg-amber-500/5 p-2 text-sm hover:bg-accent">
                    <span>Yeniden inceleme gerekli</span>
                    <span className="font-bold tabular-nums">{d.accounting.needs_review}</span>
                  </div>
                </Link>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">İstasyon bazında tamamlanan operasyon</CardTitle>
                <CardDescription>Dönem içinde tamamlanma tarihine göre.</CardDescription>
              </CardHeader>
              <CardContent>
                {chart.every((c) => c.Operasyon === 0) ? (
                  <p className="text-sm text-muted-foreground">Bu dönemde tamamlanan operasyon yok.</p>
                ) : (
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chart} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} height={56} textAnchor="end" />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="Operasyon" fill="hsl(var(--primary))" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Müşteri bazında özet</CardTitle>
              <CardDescription>Dönemde gerçekleşen üretim ve sevkiyat.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {d.customers.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Bu dönemde üretim kaydı yok.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Firma</TableHead>
                      <TableHead className="text-right">Sipariş</TableHead>
                      <TableHead className="text-right">Silindir</TableHead>
                      <TableHead className="text-right">Operasyon</TableHead>
                      <TableHead className="text-right">İş kalemi</TableHead>
                      <TableHead className="text-right">Rework operasyonu</TableHead>
                      <TableHead className="text-right">Sevk edilen takım</TableHead>
                      <TableHead className="text-right">Sevk edilen silindir</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.customers.map((c) => (
                      <TableRow key={c.customer_id}>
                        <TableCell className="font-medium">{c.customer}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.orders}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.cylinders}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.operations}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.work_items}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.rework_operations}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.shipped_teams}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.shipped_cylinders}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Dönemdeki sevkiyatlar</CardTitle>
              <CardDescription>Sevk tarihine göre; Sevkiyata Hazır ile karıştırılmaz.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {d.shipments.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Bu dönemde sevkiyat yok.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Firma</TableHead>
                      <TableHead>İş emri / iş adı</TableHead>
                      <TableHead className="text-right">Silindir</TableHead>
                      <TableHead>Termin</TableHead>
                      <TableHead>Sevk</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.shipments.map((s) => (
                      <TableRow key={s.shipment_id}>
                        <TableCell className="font-medium">{s.customer}</TableCell>
                        <TableCell className="text-xs">
                          {s.work_order_no} · {s.order_name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{s.cylinders}</TableCell>
                        <TableCell className="text-xs">{trDateOnly(s.due_on)}</TableCell>
                        <TableCell className="text-xs">{trTime(s.shipped_at)}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={s.on_time ? "secondary" : "outline"}>
                            {s.on_time ? "Zamanında" : "Gecikmeli"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground">
            Ciro, kârlılık, TL maliyeti ve ücretsiz işçilik maliyeti hesaplanmaz — bunlar için veri ve
            kapsam yok. Operasyon süreleri toplamı ({minText(
              d.stations.reduce((a, s) => a + s.minutes, 0),
            )}) makine çalışma süresi değildir.
          </p>
        </>
      ) : null}
    </div>
  );
}
