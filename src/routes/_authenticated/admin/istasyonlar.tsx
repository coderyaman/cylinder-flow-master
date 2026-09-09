import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/istasyonlar")({
  head: () => ({
    meta: [
      { title: "İstasyon ve Makine Tanımları — Rotagravür MES" },
      { name: "description", content: "Üretim istasyonları ve istasyonlara bağlı makine tanımları." },
      { property: "og:title", content: "İstasyon ve Makine Tanımları — Rotagravür MES" },
      { property: "og:description", content: "Üretim istasyonu ve makine tanımlarının yönetimi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StationsAdmin,
});

function StationsAdmin() {
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission("admin.configure");
  const queryClient = useQueryClient();

  const [stationCode, setStationCode] = useState("");
  const [stationName, setStationName] = useState("");
  const [machineStation, setMachineStation] = useState<string>("");
  const [machineCode, setMachineCode] = useState("");
  const [machineName, setMachineName] = useState("");

  const { data: stations } = useQuery({
    queryKey: ["stations-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stations")
        .select("id, code, name, sort_order, is_active")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: machines } = useQuery({
    queryKey: ["machines-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("machines")
        .select("id, station_id, code, name, is_active")
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["stations-admin"] });
    queryClient.invalidateQueries({ queryKey: ["stations"] });
    queryClient.invalidateQueries({ queryKey: ["machines-admin"] });
  };

  // Tüm yazma işlemleri sunucudaki işlem fonksiyonlarıyla yapılır; denetim kaydı aynı işlemde oluşur.
  async function addStation(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("admin_create_station", {
      _code: stationCode.trim().toUpperCase(),
      _name: stationName.trim(),
    });
    if (error) { toast.error("İstasyon eklenemedi: " + error.message); return; }
    setStationCode("");
    setStationName("");
    toast.success("İstasyon eklendi");
    refresh();
  }

  async function addMachine(e: React.FormEvent) {
    e.preventDefault();
    if (!machineStation) { toast.error("Önce istasyon seçin"); return; }
    const { error } = await supabase.rpc("admin_create_machine", {
      _station_id: machineStation,
      _code: machineCode.trim().toUpperCase(),
      _name: machineName.trim(),
    });
    if (error) { toast.error("Makine eklenemedi: " + error.message); return; }
    setMachineCode("");
    setMachineName("");
    toast.success("Makine eklendi");
    refresh();
  }

  async function toggleStationActive(id: string, active: boolean) {
    const { error } = await supabase.rpc("admin_set_station_active", {
      _station_id: id,
      _active: active,
    });
    if (error) { toast.error("Güncellenemedi: " + error.message); return; }
    refresh();
  }

  async function toggleMachineActive(id: string, active: boolean) {
    const { error } = await supabase.rpc("admin_set_machine_active", {
      _machine_id: id,
      _active: active,
    });
    if (error) { toast.error("Güncellenemedi: " + error.message); return; }
    refresh();
  }

  if (!isAdmin) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Yetkiniz yok</CardTitle>
          <CardDescription>İstasyon ve makine tanımları yalnızca Admin tarafından değiştirilir.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">İstasyonlar ve makineler</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bir istasyonda birden fazla makine olabilir. Tanımlar sonraki aşamalarda rota ve operasyon
          akışında kullanılacaktır.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">İstasyonlar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {(stations ?? []).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{s.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{s.code}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {(machines ?? []).filter((m) => m.station_id === s.id).length} makine
                    </Badge>
                    <Switch
                      checked={s.is_active}
                      onCheckedChange={(v) => toggleStationActive(s.id, v)}
                    />
                  </div>
                </li>
              ))}
            </ul>

            <form className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2" onSubmit={addStation}>
              <div className="space-y-1">
                <Label htmlFor="st-code">Kod</Label>
                <Input
                  id="st-code"
                  required
                  value={stationCode}
                  onChange={(e) => setStationCode(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="st-name">Ad</Label>
                <Input
                  id="st-name"
                  required
                  value={stationName}
                  onChange={(e) => setStationName(e.target.value)}
                />
              </div>
              <Button type="submit" className="sm:col-span-2">
                İstasyon ekle
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Makineler</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {(machines ?? []).map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {m.code} · {(stations ?? []).find((s) => s.id === m.station_id)?.name}
                    </p>
                  </div>
                  <Switch checked={m.is_active} onCheckedChange={(v) => toggleMachineActive(m.id, v)} />
                </li>
              ))}
              {(machines ?? []).length === 0 && (
                <li className="text-sm text-muted-foreground">Henüz makine tanımlanmadı.</li>
              )}
            </ul>

            <form className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2" onSubmit={addMachine}>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="mc-station">İstasyon</Label>
                <select
                  id="mc-station"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={machineStation}
                  onChange={(e) => setMachineStation(e.target.value)}
                  required
                >
                  <option value="">Seçin…</option>
                  {(stations ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mc-code">Kod</Label>
                <Input
                  id="mc-code"
                  required
                  value={machineCode}
                  onChange={(e) => setMachineCode(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mc-name">Ad</Label>
                <Input
                  id="mc-name"
                  required
                  value={machineName}
                  onChange={(e) => setMachineName(e.target.value)}
                />
              </div>
              <Button type="submit" className="sm:col-span-2">
                Makine ekle
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
