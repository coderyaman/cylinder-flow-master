import { createFileRoute, Outlet, redirect, Link, useNavigate } from "@tanstack/react-router";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AppShell,
});

const NAV = [
  { to: "/panel", label: "Genel" },
  { to: "/siparisler", label: "Siparişler" },
  { to: "/admin/musteriler", label: "Müşteriler", permission: "admin.configure" },
  { to: "/admin/kullanicilar", label: "Kullanıcılar", permission: "admin.configure" },
  { to: "/admin/istasyonlar", label: "İstasyonlar", permission: "admin.configure" },
  { to: "/kayitlar", label: "Denetim kaydı", permission: "audit.read" },
] as const;


function AppShell() {
  const { profile, roles, hasPermission, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="text-sm font-bold uppercase tracking-[0.2em] text-primary">
            Rotagravür MES
          </span>
          <nav className="flex flex-wrap gap-1">
            {NAV.filter((item) => !("permission" in item) || hasPermission(item.permission)).map(
              (item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&.active]:bg-accent [&.active]:text-foreground"
                >
                  {item.label}
                </Link>
              ),
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">
                {profile?.full_name || profile?.email}
              </p>
              <div className="flex flex-wrap justify-end gap-1">
                {roles.length === 0 ? (
                  <Badge variant="outline">Rol atanmadı</Badge>
                ) : (
                  roles.map((r) => (
                    <Badge key={r} variant="secondary">
                      {ROLE_LABELS[r]}
                    </Badge>
                  ))
                )}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              Çıkış
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
