import { Link, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  Boxes,
  ClipboardCheck,
  Factory,
  FileClock,
  Gauge,
  ListTodo,
  LogOut,
  PackageCheck,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Users,
  UsersRound,
  Warehouse,
} from "lucide-react";

import { useAuth } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import { OperonBrand } from "@/components/operon-mark";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Gauge;
  permission?: string;
};

const GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Genel", items: [{ to: "/panel", label: "Genel Bakış", icon: Gauge }] },
  {
    label: "İş Hazırlığı",
    items: [
      { to: "/admin/musteriler", label: "Müşteriler", icon: UsersRound, permission: "admin.configure" },
      { to: "/siparisler", label: "Siparişler", icon: ReceiptText },
      { to: "/depo", label: "Depo", icon: Warehouse, permission: "inventory.receive" },
    ],
  },
  {
    label: "Üretim ve Kalite",
    items: [
      { to: "/uretim", label: "Üretim Panosu", icon: Factory, permission: "team.manage" },
      { to: "/kuyruk", label: "İstasyon Kuyrukları", icon: ListTodo, permission: "team.manage" },
      { to: "/operator", label: "Operatör Ekranı", icon: Boxes, permission: "operation.start" },
      { to: "/kalite", label: "Kalite / Karar Bekleyenler", icon: ClipboardCheck, permission: "rework.approve" },
    ],
  },
  {
    label: "Sevkiyat ve Ticari İşlemler",
    items: [
      { to: "/sevkiyat", label: "Sevkiyat", icon: PackageCheck, permission: "shipment.confirm" },
      { to: "/muhasebe", label: "Muhasebe", icon: ReceiptText, permission: "accounting.process" },
      { to: "/arsiv", label: "Arşiv", icon: Archive },
    ],
  },
  {
    label: "Sistem Yönetimi",
    items: [
      { to: "/admin/kullanicilar", label: "Kullanıcılar ve Yetkiler", icon: Users, permission: "admin.configure" },
      { to: "/admin/istasyonlar", label: "İstasyonlar ve Makineler", icon: Settings2, permission: "admin.configure" },
      { to: "/kayitlar", label: "Denetim Kaydı", icon: FileClock, permission: "audit.read" },
    ],
  },
];

export function AppSidebar({ onSignOut }: { onSignOut: () => void }) {
  const { profile, roles, hasPermission } = useAuth();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const path = useRouterState({ select: (router) => router.location.pathname });
  const collapsed = state === "collapsed";

  const visibleGroups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || hasPermission(item.permission)),
  })).filter((group) => group.items.length > 0);

  const isActive = (to: string) => path === to || (to !== "/panel" && path.startsWith(`${to}/`));

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="h-17 justify-center border-b border-sidebar-border px-3">
        <Link to="/panel" aria-label="Operon ana sayfa" className="outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <OperonBrand compact={collapsed && !isMobile} />
        </Link>
      </SidebarHeader>
      <SidebarContent className="gap-1 px-2 py-3">
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label} className="p-1">
            <SidebarGroupLabel className="h-7 px-2 text-[10px] font-semibold uppercase text-sidebar-foreground/45">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.to)}
                      tooltip={item.label}
                      className="h-9 rounded-lg px-2.5 text-sidebar-foreground/72 data-[active=true]:border data-[active=true]:border-sidebar-primary/25 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-primary"
                    >
                      <Link to={item.to} onClick={() => isMobile && setOpenMobile(false)}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/45 p-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary">
            {(profile?.full_name || profile?.email || "O").slice(0, 1).toLocaleUpperCase("tr")}
          </span>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-xs font-semibold text-sidebar-foreground">{profile?.full_name || profile?.email}</p>
            <p className="truncate text-[10px] text-sidebar-foreground/55">
              {roles.length ? roles.map((role) => ROLE_LABELS[role]).join(", ") : "Rol atanmadı"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onSignOut}
            aria-label="Çıkış yap"
            title="Çıkış yap"
            className="size-8 shrink-0 text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:hidden"
          >
            <LogOut />
          </Button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}