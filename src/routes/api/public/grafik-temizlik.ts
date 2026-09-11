import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

// Kaydı olmayan (sahipsiz) yüklemeleri temizler. Kayıtlı revizyonlara asla dokunmaz.
export const Route = createFileRoute("/api/public/grafik-temizlik")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data, error } = await supabaseAdmin.rpc("srv_graphic_orphan_sessions", {
          _older_minutes: 60,
        });
        if (error) return new Response(error.message, { status: 500 });

        const rows = (data ?? []) as { session_id: string; storage_path: string }[];
        if (rows.length === 0) return Response.json({ cleaned: 0 });

        const removal = await supabaseAdmin.storage
          .from("grafik-pdf")
          .remove(rows.map((r) => r.storage_path));
        if (removal.error) return new Response(removal.error.message, { status: 500 });

        const marked = await supabaseAdmin.rpc("srv_graphic_mark_cleaned", {
          _session_ids: rows.map((r) => r.session_id),
        });
        if (marked.error) return new Response(marked.error.message, { status: 500 });

        return Response.json({ cleaned: marked.data });
      },
    },
  },
});
