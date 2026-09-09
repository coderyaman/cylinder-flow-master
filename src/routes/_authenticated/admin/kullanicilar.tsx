import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { APP_ROLES, ROLE_LABELS, type AppRole } from "@/lib/roles";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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
      { name: "description", content: "Kullanıcı davetleri, roller, istasyon yetkileri ve kişiye özel izinler." },
      { property: "og:title", content: "Kullanıcı ve Yetki Yönetimi — Rotagravür MES" },
      { property: "og:description", content: "Davet, rol, istasyon yetkisi ve kişiye özel izin yönetimi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UsersAdmin,
});

/** Sunucu hatalarını kullanıcıya anlaşılır Türkçe mesaja çevirir. */
function friendly(message: string) {
  if (message.includes("SON_ADMIN")) return "Sistemde en az bir aktif Admin kalmalıdır.";
  if (message.includes("PASIF_HESAP")) return "Hesabınız pasif durumda, işlem yapamazsınız.";
  if (message.includes("YETKISIZ")) return "Bu işlem için yetkiniz yok.";
  if (message.includes("GECERSIZ")) return message.split(":").slice(1).join(":").trim();
  return message;
}

function UsersAdmin() {
  const { hasPermission, userId } = useAuth();
  const isAdmin = hasPermission("admin.configure");
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("");

  const { data: users } = useQuery({
    queryKey: ["admin-users"],
    enabled: isAdmin,
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

  const { data: invites } = useQuery({
    queryKey: ["user-invites"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_invites")
        .select("id, email, role, full_name, created_at, accepted_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: stations } = useQuery({
    queryKey: ["stations"],
    enabled: isAdmin,
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
    enabled: isAdmin,
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
    queryClient.invalidateQueries({ queryKey: ["user-invites"] });
    queryClient.invalidateQueries({ queryKey: ["account"] });
  };

  /** Tüm değişiklikler sunucudaki işlem fonksiyonlarıyla yapılır; denetim kaydı aynı işlemde yazılır. */
  async function run(promise: PromiseLike<{ error: { message: string } | null }>, ok: string) {
    const { error } = await promise;
    if (error) {
      toast.error(friendly(error.message));
      return false;
    }
    toast.success(ok);
    refresh();
    return true;
  }

  const toggleRole = (targetId: string, role: AppRole, on: boolean) =>
    run(
      supabase.rpc("admin_set_user_role", { _user_id: targetId, _role: role, _on: on }),
      "Rol güncellendi",
    );

  const toggleStation = (targetId: string, stationId: string, on: boolean) =>
    run(
      supabase.rpc("admin_set_station_scope", {
        _user_id: targetId,
        _station_id: stationId,
        _on: on,
      }),
      "İstasyon yetkisi güncellendi",
    );

  const setOverride = (targetId: string, code: string, granted: boolean | null) =>
    run(
      supabase.rpc("admin_set_permission_override", {
        _user_id: targetId,
        _permission_code: code,
        _granted: granted as boolean,
        ...(granted === null
          ? {}
          : { _reason: granted ? "Admin ek yetki verdi" : "Admin yetkiyi kaldırdı" }),
      }),
      "Kişiye özel yetki güncellendi",
    );

  const toggleActive = (targetId: string, active: boolean) =>
    run(
      supabase.rpc("admin_set_user_active", { _user_id: targetId, _active: active }),
      active ? "Kullanıcı aktifleştirildi" : "Kullanıcı pasifleştirildi",
    );

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(
      supabase.rpc("admin_invite_user", {
        _email: inviteEmail.trim().toLowerCase(),
        ...(inviteRole ? { _role: inviteRole as AppRole } : {}),
        ...(inviteName.trim() ? { _full_name: inviteName.trim() } : {}),
      }),
      "Davet oluşturuldu",
    );
    if (ok) {
      setInviteEmail("");
      setInviteName("");
      setInviteRole("");
    }
  }

  const revokeInvite = (id: string) =>
    run(supabase.rpc("admin_revoke_invite", { _invite_id: id }), "Davet kaldırıldı");

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
          Sisteme yalnızca davet edilen kişiler kayıt olabilir. Her değişiklik, değişiklikle aynı anda
          silinemez denetim kaydına yazılır.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kullanıcı daveti</CardTitle>
          <CardDescription>
            Davet edilen e-posta kayıt olduğunda seçilen rolü otomatik alır.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="grid gap-3 sm:grid-cols-4" onSubmit={invite}>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="inv-mail">E-posta</Label>
              <Input
                id="inv-mail"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-name">Ad soyad</Label>
              <Input id="inv-name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-role">Rol</Label>
              <select
                id="inv-role"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                <option value="">Rol yok</option>
                {APP_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" className="sm:col-span-4">
              Davet oluştur
            </Button>
          </form>

          <ul className="space-y-2">
            {(invites ?? []).map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{i.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.role ? ROLE_LABELS[i.role as AppRole] : "Rol yok"} ·{" "}
                    {i.accepted_at ? "Kayıt tamamlandı" : "Bekliyor"}
                  </p>
                </div>
                {!i.accepted_at && (
                  <Button size="sm" variant="outline" onClick={() => revokeInvite(i.id)}>
                    Daveti kaldır
                  </Button>
                )}
              </li>
            ))}
            {(invites ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">Henüz davet yok.</li>
            )}
          </ul>
        </CardContent>
      </Card>

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
                Boş bırakılan izinler rolün varsayılanını kullanır. Sistem yönetimi izni, son aktif
                Admin'den alınamaz.
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
