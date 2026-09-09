import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { orderErrorText } from "@/lib/orders";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/admin/musteriler")({
  head: () => ({
    meta: [
      { title: "Müşteri Tanımları — Rotagravür MES" },
      { name: "description", content: "Sipariş açılabilen firmaların tanımı ve aktiflik yönetimi." },
      { property: "og:title", content: "Müşteri Tanımları — Rotagravür MES" },
      { property: "og:description", content: "Firma tanımları ve aktiflik yönetimi." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomersAdmin,
});

function normalize(v: string) {
  return v.trim().toLocaleLowerCase("tr");
}

function CustomersAdmin() {
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission("admin.configure");
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const { data: customers } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, is_active")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["customers"] });

  const similar = (customers ?? []).filter(
    (c) => name.trim() !== "" && normalize(c.name) === normalize(name),
  );

  async function addCustomer(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("admin_create_customer", { _name: name.trim() });
    if (error) return void toast.error(orderErrorText(error.message));
    setName("");
    toast.success("Müşteri eklendi");
    refresh();
  }

  async function saveEdit() {
    if (!editing) return;
    const { error } = await supabase.rpc("admin_update_customer", {
      _customer_id: editing.id,
      _name: editing.name.trim(),
    });
    if (error) return void toast.error(orderErrorText(error.message));
    setEditing(null);
    toast.success("Müşteri güncellendi");
    refresh();
  }

  async function toggleActive(id: string, active: boolean) {
    const { error } = await supabase.rpc("admin_set_customer_active", {
      _customer_id: id,
      _active: active,
    });
    if (error) return void toast.error(orderErrorText(error.message));
    refresh();
  }

  if (!isAdmin) {
    return (
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Yetkiniz yok</CardTitle>
          <CardDescription>Müşteri tanımlarını yalnızca Admin yönetir.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Müşteriler</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pasif müşteriye yeni sipariş açılamaz; geçmiş siparişleri okunur kalır.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tanımlı firmalar</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2">
            {(customers ?? []).map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                {editing?.id === c.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={editing.name}
                      onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                    />
                    <Button size="sm" onClick={saveEdit}>
                      Kaydet
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                      Vazgeç
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium">{c.name}</p>
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing({ id: c.id, name: c.name })}
                      >
                        Adı düzenle
                      </Button>
                      <Switch
                        checked={c.is_active}
                        onCheckedChange={(v) => toggleActive(c.id, v)}
                      />
                    </div>
                  </>
                )}
              </li>
            ))}
            {(customers ?? []).length === 0 && (
              <li className="text-sm text-muted-foreground">Henüz müşteri tanımlanmadı.</li>
            )}
          </ul>

          <form className="space-y-3 border-t border-border pt-4" onSubmit={addCustomer}>
            <div className="space-y-1">
              <Label htmlFor="cu-name">Firma adı</Label>
              <Input id="cu-name" required value={name} onChange={(e) => setName(e.target.value)} />
              {similar.length > 0 && (
                <p className="text-xs text-amber-600">
                  Aynı adla kayıtlı müşteri var ({similar.length} adet). Yine de ekleyebilirsiniz.
                </p>
              )}
            </div>
            <Button type="submit">Müşteri ekle</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
