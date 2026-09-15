import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth";
import { OperonSymbol } from "@/components/operon-mark";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Operon — Üretim Yönetim Platformu" },
      {
        name: "description",
        content:
          "Rotagravür silindir işlemeciliği için sipariş, silindir, istasyon ve sevkiyat takibi yapan üretim yönetim sistemi.",
      },
      { property: "og:title", content: "Operon — Üretim Yönetim Platformu" },
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
    if (!loading) navigate({ to: session ? "/panel" : "/auth", replace: true });
  }, [loading, session, navigate]);

  return (
    <main className="grid min-h-screen place-items-center bg-background" aria-busy="true">
      <div className="flex flex-col items-center gap-4 text-muted-foreground">
        <OperonSymbol className="size-10 animate-pulse" />
        <span className="text-sm font-medium">Oturum kontrol ediliyor…</span>
      </div>
    </main>
  );
}
