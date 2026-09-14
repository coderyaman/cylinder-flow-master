import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { newIdempotencyKey } from "@/lib/orders";
import { formatMm, SURFACE_LABELS } from "@/lib/cylinders";
import { PLANNED_OP_LABELS, teamErrorText, type PlannedOp } from "@/lib/teams";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/rota/$orderId")({
  head: () => ({
    meta: [
      { title: "Rotaları Hazırla — Rotagravür MES" },
      {
        name: "description",
        content:
          "Takım üyelerinin rota adımlarını önizleyin, düzenleyin ve hazır üyeleri ilk gerekli istasyon kuyruğuna bırakın.",
      },
      { property: "og:title", content: "Rotaları Hazırla — Rotagravür MES" },
      {
        property: "og:description",
        content: "Rota önizleme, atlama gerekçesi ve üretime alma ekranı.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RoutesScreen,
});

type Step = {
  seq: number;
  station_id: string;
  station_code?: string;
  station_name?: string;
  op_label: string;
  skipped: boolean;
  skip_reason: string | null;
  status?: string;
};

function RoutesScreen() {
  const { orderId } = Route.useParams();
  const { hasPermission } = useAuth();
  const canPlan = hasPermission("team.manage");
  const canRelease = hasPermission("production.release");
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Step[]>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [releaseKey, setReleaseKey] = useState(() => newIdempotencyKey());

  const stationsQuery = useQuery({
    queryKey: ["stations-active-route"],
    queryFn: async () => {
      // Prova takım düzeyinde tek operasyondur; silindir rotasına adım olarak eklenmez.
      const { data, error } = await supabase
        .from("stations")
        .select("id, code, name, sort_order")
        .eq("is_active", true)
        .neq("code", "PROVA")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });


  const dataQuery = useQuery({
    queryKey: ["route-screen", orderId],
    queryFn: async () => {
      const { data: order, error: e0 } = await supabase
        .from("orders")
        .select("id, work_order_no, name, quantity, customer_id, customers(name)")
        .eq("id", orderId)
        .maybeSingle();
      if (e0) throw e0;
      const { data: team, error: e1 } = await supabase
        .from("teams")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle();
      if (e1) throw e1;
      if (!team) return { order, team: null, members: [] as any[], plans: [] as any[] };
      const { data: members, error: e2 } = await supabase
        .from("team_members")
        .select(
          "*, cylinder_receipts(cyl_code, surface_state, measured_circumference_mm, measured_diameter_mm, measured_length_mm, lifecycle, measurements_recorded, nominal_circumference_mm, nominal_length_mm)",
        )
        .eq("team_id", team.id)
        .eq("is_active", true)
        .order("sequence_no");
      if (e2) throw e2;
      const ids = (members ?? []).map((m: any) => m.id);
      let plans: any[] = [];
      if (ids.length) {
        const { data: p, error: e3 } = await supabase
          .from("route_plans")
          .select("*, route_steps(*, stations(code, name))")
          .in("team_member_id", ids)
          .eq("status", "yururlukte");
        if (e3) throw e3;
        plans = p ?? [];
      }
      return { order, team, members: members ?? [], plans };
    },
  });

  const members = dataQuery.data?.members ?? [];
  const plans = dataQuery.data?.plans ?? [];
  const planByMember = new Map<string, any>(plans.map((p: any) => [p.team_member_id, p]));

  // Sunucudaki yürürlükteki rotayı yalnızca kullanıcı taslağı yoksa yükle.
  useEffect(() => {
    setDrafts((prev) => {
      const next = { ...prev };
      for (const m of members) {
        if (next[m.id]) continue;
        const plan = planByMember.get(m.id);
        if (!plan) continue;
        next[m.id] = [...(plan.route_steps ?? [])]
          .sort((a: any, b: any) => a.seq - b.seq)
          .map((s: any) => ({
            seq: s.seq,
            station_id: s.station_id,
            station_code: s.stations?.code,
            station_name: s.stations?.name,
            op_label: s.op_label,
            skipped: s.skipped,
            skip_reason: s.skip_reason,
            status: s.status,
          }));
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans.length, members.length]);

  async function loadSuggestion(memberId: string) {
    const { data, error } = await supabase.rpc("route_suggest", { _member_id: memberId });
    if (error) return void toast.error(teamErrorText(error.message));
    const steps = ((data as any)?.steps ?? []) as Step[];
    setDrafts((p) => ({ ...p, [memberId]: steps }));
    toast.success("Şablon önerisi yüklendi. Kaydetmeden üretimi etkilemez.");
  }

  async function savePlan(memberId: string) {
    const steps = drafts[memberId] ?? [];
    if (steps.length === 0) return void toast.error("Rota en az bir adım içermelidir.");
    if (steps.some((s) => s.skipped && !s.skip_reason?.trim()))
      return void toast.error("Atlanan adım için gerekçe zorunludur.");
    setBusy(true);
    const { error } = await supabase.rpc("route_save_plan", {
      _member_id: memberId,
      _steps: steps.map((s, i) => ({
        seq: i + 1,
        station_id: s.station_id,
        op_label: s.op_label,
        skipped: s.skipped,
        skip_reason: s.skip_reason,
      })) as any,
      _idempotency_key: newIdempotencyKey(),
    });
    setBusy(false);
    if (error) return void toast.error(teamErrorText(error.message));
    toast.success("Rota kaydedildi. Üretim başlamadı.");
    qc.invalidateQueries({ queryKey: ["route-screen", orderId] });
  }

  async function release() {
    const ids = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (ids.length === 0) return void toast.error("Önce üye seçin.");
    setBusy(true);
    const { data, error } = await supabase.rpc("release_to_production", {
      _member_ids: ids,
      _idempotency_key: releaseKey,
    });
    setBusy(false);
    if (error) return void toast.error(teamErrorText(error.message));
    const rows = ((data as any)?.result ?? []) as {
      member_id: string;
      released: boolean;
      reason: string | null;
    }[];
    const ok = rows.filter((r) => r.released).length;
    const fail = rows.filter((r) => !r.released);
    if (ok > 0) toast.success(`${ok} üye ilk gerekli kuyruğa bırakıldı.`);
    for (const f of fail) toast.error(`Üretime alınamadı: ${f.reason ?? "bilinmeyen neden"}`);
    setSelected({});
    setReleaseKey(newIdempotencyKey());
    qc.invalidateQueries({ queryKey: ["route-screen", orderId] });
    qc.invalidateQueries({ queryKey: ["kuyruk"] });
  }

  if (dataQuery.isLoading) return <p className="text-sm text-muted-foreground">Yükleniyor…</p>;
  if (dataQuery.isError)
    return <p className="text-sm text-destructive">Veri okunamadı. Sayfayı yenileyin.</p>;

  const order = dataQuery.data?.order;
  const team = dataQuery.data?.team;

  if (!team)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Takım yok</CardTitle>
          <CardDescription>
            Önce sipariş için silindirleri hazırlayın ve takımı oluşturun.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/silindir-hazirla/$orderId" params={{ orderId }}>
              Silindirleri Hazırla
            </Link>
          </Button>
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/siparis/$orderId"
          params={{ orderId }}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Sipariş kartı
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Rotaları Hazırla</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {order?.customers?.name} · #{order?.work_order_no} · {order?.name} ·{" "}
          <span className="font-mono">{team.team_code}</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Rota önizlemesi üretimi başlatmaz. Üretime alma yalnızca ilk gerekli adımı kuyruğa bırakır;
          sonraki adımlar planlı kalır. Prova ileride takım düzeyinde ele alınacaktır.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-md border p-3">
        <p className="text-sm text-muted-foreground">
          Seçili üye: {Object.values(selected).filter(Boolean).length} / {members.length}
        </p>
        <Button className="ml-auto" disabled={!canRelease || busy} onClick={release}>
          Üretime Al
        </Button>
        {!canRelease && (
          <p className="text-xs text-muted-foreground">Üretime alma yetkiniz yok.</p>
        )}
      </div>

      {members.map((m: any) => {
        const rec = m.cylinder_receipts;
        const plan = planByMember.get(m.id);
        const steps = drafts[m.id] ?? [];
        const released = !!m.released_at;
        const queued = (plan?.route_steps ?? []).find((s: any) => s.status === "kuyrukta");
        return (
          <Card key={m.id}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!selected[m.id]}
                  disabled={released || !canRelease}
                  onChange={(e) => setSelected((p) => ({ ...p, [m.id]: e.target.checked }))}
                />
                <CardTitle className="text-base">
                  {m.sequence_no}.{" "}
                  <span className="font-mono">{rec?.cyl_code ?? "Planlanan yeni imalat"}</span>
                </CardTitle>
                <Badge variant={m.kind === "mevcut" ? "secondary" : "outline"}>
                  {m.kind === "mevcut" ? "Fiziksel silindir" : "Planlanan imalat"}
                </Badge>
                {rec && (rec as any).measurements_recorded !== false && (
                  <Badge variant="outline">
                    {SURFACE_LABELS[rec.surface_state as keyof typeof SURFACE_LABELS]}
                  </Badge>
                )}
                {released ? (
                  <Badge>Üretime alındı</Badge>
                ) : (
                  <Badge variant="outline">Bekliyor</Badge>
                )}
                {queued && (
                  <Badge variant="secondary">Kuyrukta: {queued.stations?.name}</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {plan ? `Rota sürümü v${plan.version}` : "Rota kaydedilmedi"}
                </span>
              </div>
              <CardDescription>
                {!rec
                  ? "Fiziksel silindir yok; Torna tamamlanınca oluşacak."
                  : (rec as any).measurements_recorded === false
                    ? `Ölçüm kaydı yok · Sipariş nominali: Çevre ${formatMm((rec as any).nominal_circumference_mm)} · Boy ${formatMm((rec as any).nominal_length_mm)}`
                    : `Çevre ${formatMm(rec.measured_circumference_mm)} · Çap ${formatMm(rec.measured_diameter_mm)} · Boy ${formatMm(rec.measured_length_mm)}`}
                {" · Planlanan ek işler: "}
                {(m.planned_ops ?? []).length === 0
                  ? "—"
                  : (m.planned_ops as PlannedOp[]).map((o) => PLANNED_OP_LABELS[o]).join(", ")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canPlan || busy || released}
                  onClick={() => loadSuggestion(m.id)}
                >
                  Şablon önerisini yükle
                </Button>
                <Button
                  size="sm"
                  disabled={!canPlan || busy || released || steps.length === 0}
                  onClick={() => savePlan(m.id)}
                >
                  Rotayı kaydet
                </Button>
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  disabled={!canPlan || released}
                  value=""
                  onChange={(e) => {
                    const st = (stationsQuery.data ?? []).find((s) => s.id === e.target.value);
                    if (!st) return;
                    setDrafts((p) => ({
                      ...p,
                      [m.id]: [
                        ...(p[m.id] ?? []),
                        {
                          seq: (p[m.id]?.length ?? 0) + 1,
                          station_id: st.id,
                          station_code: st.code,
                          station_name: st.name,
                          op_label: st.name,
                          skipped: false,
                          skip_reason: null,
                        },
                      ],
                    }));
                  }}
                >
                  <option value="">Adım ekle…</option>
                  {(stationsQuery.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {steps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Henüz rota adımı yok. Şablon önerisini yükleyip düzenleyin.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-y bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left">Sıra</th>
                        <th className="px-2 py-2 text-left">İstasyon</th>
                        <th className="px-2 py-2 text-left">İşlem</th>
                        <th className="px-2 py-2 text-left">Durum</th>
                        <th className="px-2 py-2 text-left">Atla</th>
                        <th className="px-2 py-2 text-left">Atlama gerekçesi</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {steps.map((s, i) => (
                        <tr key={`${m.id}-${i}`} className="border-b last:border-0">
                          <td className="px-2 py-1.5">{i + 1}</td>
                          <td className="px-2 py-1.5">
                            {s.station_name ??
                              (stationsQuery.data ?? []).find((x) => x.id === s.station_id)?.name ??
                              "—"}
                          </td>
                          <td className="px-2 py-1.5">{s.op_label}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {s.status === "kuyrukta"
                              ? "Kuyrukta"
                              : s.status === "atlandi"
                                ? "Atlandı"
                                : s.status === "tamamlandi"
                                  ? "Tamamlandı"
                                  : "Planlandı"}
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={s.skipped}
                              disabled={!canPlan || released}
                              onChange={(e) =>
                                setDrafts((p) => {
                                  const arr = [...(p[m.id] ?? [])];
                                  arr[i] = { ...arr[i]!, skipped: e.target.checked };
                                  return { ...p, [m.id]: arr };
                                })
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              className="h-8"
                              value={s.skip_reason ?? ""}
                              disabled={!canPlan || !s.skipped || released}
                              placeholder={s.skipped ? "Gerekçe zorunlu" : "—"}
                              onChange={(e) =>
                                setDrafts((p) => {
                                  const arr = [...(p[m.id] ?? [])];
                                  arr[i] = { ...arr[i]!, skip_reason: e.target.value };
                                  return { ...p, [m.id]: arr };
                                })
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!canPlan || released}
                              onClick={() =>
                                setDrafts((p) => ({
                                  ...p,
                                  [m.id]: (p[m.id] ?? []).filter((_, x) => x !== i),
                                }))
                              }
                            >
                              Çıkar
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
