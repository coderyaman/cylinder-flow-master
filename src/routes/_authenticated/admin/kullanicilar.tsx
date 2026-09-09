import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { APP_ROLES, ROLE_LABELS, type AppRole } from "@/lib/roles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/kullanicilar")({
  head: () => ({
    meta: [
      { title: "Kullanıcı ve Yetki Yönetimi — Rotagravür MES" },
      { name: "description", content: "Kullanıcı rolleri, istasyon yetkileri ve kişiye özel izinler." },
      { property: "og:title", content: "Kullanıcı ve Yetki Yönetimi — Rotagravür MES" },
      { property: "og:description", content: "Rol, istasyon yetkisi ve kişiye özel izin yönetimi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsersAdmin,
});

function UsersAdmin() {
  const { hasPermission, userId } = useAuth();
  const isAdmin = hasPermission("admin.configure");
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const { data: users } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const [profiles, roles, scopes, overrides] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, is_active").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("user_station_scopes").select("user_id, station_id"),
        supabase.from("user_permission_overrides").select("user_id, permission_code, granted"),
      ]);
      if (profiles.error) throw profiles.error;
      return (profiles.data ?? []).map((p) => ({
        ...p,
        roles: (roles.data ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole),
        stationIds: (scopes.data ?? []).filter((s) => s.user_id === p.id).map((s) => s.station_id),
        overrides: (overrides.data ?? []).filter((o) => o.user_id === p.id),
      }));
    },
  });

  const { data: stations } = useQuery({
    queryKey: ["stations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stations")
        .select("id, code, name, is_active")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: permissions } = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("permissions")
        .select("code, label, category")
        .order("category");
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    queryClient.invalidateQueries({ queryKey: ["account"] });
  };

  async function toggleRole(targetId: string, role: AppRole, on: boolean) {
    if (on) {
      const { error } = await supabase.from("user_roles").insert({ user_id: targetId, role });
      if (error) { toast.error("Rol atanamadı: " + error.message); return; }
      await writeAudit({
        action: "role.granted",
        entityType: "user_roles",
        entityId: targetId,
        newValue: { role },
      });
    } else {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", targetId)
        .eq("role", role);
      if (error) { toast.error("Rol kaldırılamadı: " + error.message); return; }
      await writeAudit({
        action: "role.revoked",
        entityType: "user_roles",
        entityId: targetId,
        oldValue: { role },
      });
    }
    toast.success("Rol güncellendi");
    refresh();
  }

  async function toggleStation(targetId: string, stationId: string, on: boolean) {
    if (on) {
      const { error } = await supabase
        .from("user_station_scopes")
        .insert({ user_id: targetId, station_id: stationId });
      if (error) { toast.error("İstasyon yetkisi verilemedi: " + error.message); return; }
      await writeAudit({
        action: "station_scope.granted",
        entityType: "user_station_scopes",
        entityId: targetId,
        newValue: { station_id: stationId },
      });
    } else {
      const { error } = await supabase
        .from("user_station_scopes")
        .delete()
        .eq("user_id", targetId)
        .eq("station_id", stationId);
      if (error) { toast.error("İstasyon yetkisi kaldırılamadı: " + error.message); return; }
      await writeAudit({
        action: "station_scope.revoked",
        entityType: "user_station_scopes",
        entityId: targetId,
        oldValue: { station_id: stationId },
      });
    }
    toast.success("İstasyon yetkisi güncellendi");
    refresh();
  }

  async function setOverride(targetId: string, code: string, granted: boolean | null) {
    if (granted === null) {
      const { error } = await supabase
        .from("user_permission_overrides")
        .delete()
        .eq("user_id", targetId)
        .eq("permission_code", code);
      if (error) { toast.error("İstisna kaldırılamadı: " + error.message); return; }
      await writeAudit({
        action: "permission_override.cleared",
        entityType: "user_permission_overrides",
        entityId: targetId,
        oldValue: { permission_code: code },
        reason: "Rol varsayılanına dönüldü",
      });
    } else {
      const { error } = await supabase.from("user_permission_overrides").upsert(
        {
          user_id: targetId,
          permission_code: code,
          granted,
          created_by: userId,
          reason: granted ? "Admin ek yetki verdi" : "Admin yetkiyi kaldırdı",
        },
        { onConflict: "user_id,permission_code" },
      );
      if (error) { toast.error("İstisna kaydedilemedi: " + error.message); return; }
      await writeAudit({
        action: "permission_override.set",
        entityType: "user_permission_overrides",
        entityId: targetId,
        newValue: { permission_code: code, granted },
      });
    }
    toast.success("Kişiye özel yetki güncellendi");
    refresh();
  }

  async function toggleActive(targetId: string, active: boolean) {
    const { error } = await supabase.from("profiles").update({ is_active: active }).eq("id", targetId);
    if (error) { toast.error("Güncellenemedi: " + error.message); return; }
    await writeAudit({
      action: "profile.active_changed",
      entityType: "profiles",
      entityId: targetId,
      oldValue: { is_active: !active },
      newValue: { is_active: active },
    });
    toast.success(active ? "Kullanıcı aktifleştirildi" : "Kullanıcı pasifleştirildi");
    refresh();
  }

  if (!isAdmin) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Yetkiniz yok</CardTitle>
          <CardDescription>
            Kullanıcı ve yetki yönetimi yalnızca Admin rolüne açıktır. Sunucu tarafındaki kurallar da
            aynı kısıtı uygular.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const current = users?.find((u) => u.id === selected) ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Kullanıcılar ve yetkiler</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rol, istasyon yetkisi ve kişiye özel izin değişikliklerinin tamamı denetim kaydına yazılır.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kullanıcı</TableHead>
                <TableHead>Roller</TableHead>
                <TableHead>İstasyon</TableHead>
                <TableHead>Aktif</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(users ?? []).map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <p className="text-sm font-medium">{u.full_name || "(isim yok)"}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell className="space-x-1">
                    {u.roles.length === 0 ? (
                      <Badge variant="outline">Yok</Badge>
                    ) : (
                      u.roles.map((r) => (
                        <Badge key={r} variant="secondary">
                          {ROLE_LABELS[r]}
                        </Badge>
                      ))
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.stationIds.length}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={u.is_active}
                      onCheckedChange={(v) => toggleActive(u.id, v)}
                      disabled={u.id === userId}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant={selected === u.id ? "secondary" : "outline"}
                      onClick={() => setSelected(selected === u.id ? null : u.id)}
                    >
                      Yetkileri düzenle
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {current && (
        <Card>
          <CardHeader>
            <CardTitle>{current.full_name || current.email}</CardTitle>
            <CardDescription>Rol, istasyon yetkisi ve kişiye özel izin ayarları</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Roller
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {APP_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={current.roles.includes(role)}
                      onCheckedChange={(v) => toggleRole(current.id, role, v === true)}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                İstasyon yetkileri
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {(stations ?? []).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={current.stationIds.includes(s.id)}
                      onCheckedChange={(v) => toggleStation(current.id, s.id, v === true)}
                    />
                    {s.name}
                  </label>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Kişiye özel izinler
              </h3>
              <p className="text-xs text-muted-foreground">
                Boş bırakılan izinler rolün varsayılanını kullanır.
              </p>
              <div className="grid gap-2 lg:grid-cols-2">
                {(permissions ?? []).map((p) => {
                  const ov = current.overrides.find((o) => o.permission_code === p.code);
                  const state = ov ? (ov.granted ? "grant" : "deny") : "default";
                  return (
                    <div
                      key={p.code}
                      className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <div>
                        <Label className="text-sm">{p.label}</Label>
                        <p className="font-mono text-[11px] text-muted-foreground">{p.code}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant={state === "grant" ? "default" : "outline"}
                          onClick={() => setOverride(current.id, p.code, true)}
                        >
                          Ver
                        </Button>
                        <Button
                          size="sm"
                          variant={state === "deny" ? "destructive" : "outline"}
                          onClick={() => setOverride(current.id, p.code, false)}
                        >
                          Kaldır
                        </Button>
                        <Button
                          size="sm"
                          variant={state === "default" ? "secondary" : "ghost"}
                          onClick={() => setOverride(current.id, p.code, null)}
                        >
                          Varsayılan
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
