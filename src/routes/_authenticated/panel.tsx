import { createFileRoute } from "@tanstack/react-router";

import { useAuth } from "@/lib/auth";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/roles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/panel")({
  head: () => ({
    meta: [
      { title: "Genel Panel — Rotagravür MES" },
      { name: "description", content: "Rolünüze göre erişebildiğiniz üretim modülleri." },
      { property: "og:title", content: "Genel Panel — Rotagravür MES" },
      { property: "og:description", content: "Rolünüze göre erişebildiğiniz üretim modülleri." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Panel,
});

const MODULES = [
  { title: "Müşteri, sipariş ve grafik", phase: "Aşama 2", permission: "orders.create" },
  { title: "Depo kabulü ve QR", phase: "Aşama 3", permission: "inventory.receive" },
  { title: "Sepet, rezervasyon ve takım", phase: "Aşama 4", permission: "team.manage" },
  { title: "Rota ve istasyon kuyrukları", phase: "Aşama 5", permission: "production.release" },
  { title: "Operatör tablet akışı", phase: "Aşama 6", permission: "operation.start" },
  { title: "Kalite, rework ve prova", phase: "Aşama 7-8", permission: "quality.request" },
  { title: "Sevkiyat ve arşiv", phase: "Aşama 9", permission: "shipment.confirm" },
  { title: "Muhasebe", phase: "Aşama 10", permission: "accounting.process" },
];

function Panel() {
  const { profile, roles, permissions, hasPermission } = useAuth();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Hoş geldiniz{profile?.full_name ? `, ${profile.full_name}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bu sürümde kimlik, rol, istasyon yetkisi ve denetim kaydı altyapısı çalışır durumdadır.
        </p>
      </section>

      {roles.length === 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Henüz rolünüz yok</CardTitle>
            <CardDescription>
              Bir Admin size rol atayana kadar üretim modüllerine erişemezsiniz.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Rolleriniz
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((role) => (
            <Card key={role}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{ROLE_LABELS[role]}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Modüller
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => {
            const allowed = hasPermission(m.permission);
            return (
              <Card key={m.title} className={allowed ? "" : "opacity-60"}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{m.title}</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  <Badge variant="outline">{m.phase}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {allowed ? "Yetkiniz var" : "Yetkiniz yok"}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Etkin yetkileriniz ({permissions.length})
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {permissions.map((p) => (
            <Badge key={p} variant="secondary" className="font-mono text-[11px]">
              {p}
            </Badge>
          ))}
        </div>
      </section>
    </div>
  );
}
