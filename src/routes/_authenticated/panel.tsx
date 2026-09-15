import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { useAuth } from "@/lib/auth";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/roles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashProductionView } from "@/components/dash-production";
import { DashBusinessView } from "@/components/dash-business";

export const Route = createFileRoute("/_authenticated/panel")({
  head: () => ({
    meta: [
      { title: "Genel Bakış — Operon" },
      {
        name: "description",
        content:
          "Rolünüze göre üretim özeti: aktif siparişler, istasyon yoğunluğu, bekleyen kararlar ve dönemsel üretim/sevkiyat toplamları.",
      },
      { property: "og:title", content: "Genel Bakış — Operon" },
      {
        property: "og:description",
        content: "Üretim ve ticari özetler tek ekranda; rakamlar kaynak kayıtlarla aynı kapsamı kullanır.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Panel,
});

function Panel() {
  const { profile, roles, permissions, hasPermission, hasRole } = useAuth();

  const canProduction = hasPermission("team.manage") || hasPermission("production.release");
  const canBusiness =
    hasRole("patron") || hasRole("admin") || hasRole("mudur") || hasPermission("accounting.process");
  const [picked, setPicked] = useState<"uretim" | "ticari" | null>(null);
  const view: "uretim" | "ticari" = picked ?? (canProduction ? "uretim" : "ticari");
  const setView = setPicked;

  return (
    <div className="space-y-7">
      <section className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
        <div>
          <p className="text-xs font-semibold text-primary">GENEL BAKIŞ</p>
          <h1 className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">
            {view === "uretim" ? "Üretim Özeti" : "Yönetici Özeti"}
          </h1>
        </div>
        {canProduction && canBusiness ? (
          <div className="flex rounded-lg border border-border bg-card p-1 shadow-sm">
            <Button
              size="sm"
              variant={view === "uretim" ? "default" : "ghost"}
              onClick={() => setView("uretim")}
            >
              Üretim
            </Button>
            <Button
              size="sm"
              variant={view === "ticari" ? "default" : "ghost"}
              onClick={() => setView("ticari")}
            >
              Yönetici
            </Button>
          </div>
        ) : null}
      </section>

      {roles.length === 0 ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Henüz rolünüz yok</CardTitle>
            <CardDescription>
              Bir Admin size rol atayana kadar üretim modüllerine erişemezsiniz.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {canProduction && (view === "uretim" || !canBusiness) ? <DashProductionView /> : null}
      {canBusiness && (view === "ticari" || !canProduction) ? <DashBusinessView /> : null}

      {!canProduction && !canBusiness && roles.length > 0 ? (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Çalışma ekranınız</CardTitle>
              <CardDescription>
                Rolünüz istasyon odaklı çalışmaya göre tanımlı; özet ekranları yerine kendi iş
                listenizi kullanın.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {hasPermission("operation.start") ? (
                <Link to="/operator">
                  <Button size="sm">Operatör ekranını aç</Button>
                </Link>
              ) : null}
              {hasPermission("inventory.receive") ? (
                <Link to="/depo">
                  <Button size="sm" variant="outline">
                    Depo ekranını aç
                  </Button>
                </Link>
              ) : null}
              {hasPermission("orders.create") ? (
                <Link to="/siparisler">
                  <Button size="sm" variant="outline">
                    Siparişler
                  </Button>
                </Link>
              ) : null}
            </CardContent>
          </Card>

          <section className="space-y-2">
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

          <section className="space-y-2">
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
      ) : null}
    </div>
  );
}
