import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/kayitlar")({
  head: () => ({
    meta: [
      { title: "Denetim Kaydı — Rotagravür MES" },
      { name: "description", content: "Silinemez denetim kaydı: kim, ne zaman, neyi değiştirdi." },
      { property: "og:title", content: "Denetim Kaydı — Rotagravür MES" },
      { property: "og:description", content: "Silinemez sistem denetim kaydı." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission("audit.read");

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, action, entity_type, entity_id, old_value, new_value, reason, created_at, actor_id")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["profiles-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, full_name, email");
      if (error) throw error;
      return data;
    },
  });

  const nameOf = (id: string | null) => {
    const p = profiles?.find((x) => x.id === id);
    return p?.full_name || p?.email || "—";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Denetim kaydı</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bu kayıtlar yalnızca eklenebilir. Admin dahil hiçbir rol denetim kaydını değiştiremez veya
          silemez.
        </p>
      </div>

      {!canRead && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Yetkiniz yok</CardTitle>
            <CardDescription>
              Denetim kaydını yalnızca Asistan, Müdür, Patron, Muhasebe ve Admin okuyabilir. Yalnızca
              kendi işlemleriniz listelenir.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Yükleniyor…</p>
          ) : (data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Kayıt yok.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zaman</TableHead>
                  <TableHead>Kullanıcı</TableHead>
                  <TableHead>İşlem</TableHead>
                  <TableHead>Nesne</TableHead>
                  <TableHead>Eski → Yeni</TableHead>
                  <TableHead>Gerekçe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {new Date(row.created_at).toLocaleString("tr-TR")}
                    </TableCell>
                    <TableCell className="text-sm">{nameOf(row.actor_id)}</TableCell>
                    <TableCell className="font-mono text-xs">{row.action}</TableCell>
                    <TableCell className="text-xs">{row.entity_type}</TableCell>
                    <TableCell className="max-w-xs truncate font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(row.old_value)} → {JSON.stringify(row.new_value)}
                    </TableCell>
                    <TableCell className="text-xs">{row.reason ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
