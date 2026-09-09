import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rotagravür MES — Silindir Bazlı Üretim Takibi" },
      {
        name: "description",
        content:
          "Rotagravür silindir işlemeciliği için sipariş, silindir, istasyon ve sevkiyat takibi yapan üretim yönetim sistemi.",
      },
      { property: "og:title", content: "Rotagravür MES — Silindir Bazlı Üretim Takibi" },
      {
        property: "og:description",
        content: "Her silindiri kabulden sevkiyata kadar tek tek izleyen üretim yönetim sistemi.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) navigate({ to: "/panel", replace: true });
  }, [loading, session, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-xl text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Rotagravür</p>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground">
          Üretim Yönetim Sistemi
        </h1>
        <p className="mt-4 text-muted-foreground">
          Her silindir, fabrikaya kabul edildiği andan sevk edildiği ana kadar tek tek izlenir.
          Sipariş durumu gerçekleşen operasyonlardan hesaplanır.
        </p>
        <div className="mt-8">
          <Button asChild size="lg">
            <Link to="/auth">Giriş yap</Link>
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Aşama 1: kullanıcılar, roller, istasyon yetkileri ve denetim kaydı.
        </p>
      </div>
    </main>
  );
}
