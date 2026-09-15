import { createFileRoute, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    return { user: data.user };
  },
  component: AppShell,
});

const PAGE_NAMES: Record<string, string> = {
  "/panel": "Genel Bakış", "/siparisler": "Siparişler", "/depo": "Depo", "/uretim": "Üretim Panosu",
  "/kuyruk": "İstasyon Kuyrukları", "/operator": "Operatör Ekranı", "/kalite": "Kalite / Karar Bekleyenler",
  "/sevkiyat": "Sevkiyat", "/muhasebe": "Muhasebe", "/arsiv": "Arşiv", "/admin/musteriler": "Müşteriler",
  "/admin/kullanicilar": "Kullanıcılar ve Yetkiler", "/admin/istasyonlar": "İstasyonlar ve Makineler", "/kayitlar": "Denetim Kaydı",
};


function AppShell() {
  const { profile, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const path = useRouterState({ select: (router) => router.location.pathname });
  const pageTitle = Object.entries(PAGE_NAMES).find(([route]) => path === route || path.startsWith(`${route}/`))?.[1] ?? "Operon";

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/auth", search: { redirect: undefined }, replace: true });
  }

  return (
    <SidebarProvider>
      <AppSidebar onSignOut={handleSignOut} />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 grid h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur-sm sm:px-6">
          <SidebarTrigger className="size-9" aria-label="Menüyü aç veya daralt" />
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium text-muted-foreground">Operon / {pageTitle}</p>
            <h1 className="truncate text-sm font-semibold text-foreground">{pageTitle}</h1>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="max-w-48 justify-end px-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-xs font-bold text-primary">{(profile?.full_name || profile?.email || "O").slice(0, 1).toLocaleUpperCase("tr")}</span>
                <span className="hidden min-w-0 text-left sm:block"><span className="block truncate text-xs font-semibold">{profile?.full_name || profile?.email}</span><span className="block truncate text-[10px] text-muted-foreground">{roles[0] ? ROLE_LABELS[roles[0]] : "Rol atanmadı"}</span></span>
                <ChevronDown className="hidden sm:block" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel><span className="block truncate">{profile?.full_name || profile?.email}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{roles.length ? roles.map((role) => ROLE_LABELS[role]).join(", ") : "Rol atanmadı"}</span></DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleSignOut}>Çıkış yap</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="mx-auto w-full max-w-[1800px] min-w-0 px-4 py-6 sm:px-6 lg:px-8"><Outlet /></main>
      </SidebarInset>
    </SidebarProvider>
  );
}
