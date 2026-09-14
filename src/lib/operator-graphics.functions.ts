import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "grafik-pdf";

/**
 * Operatöre yalnızca kendi devam eden Gravür işine bağlı PDF revizyonunu açar.
 * Siparişin tüm dosyalarını görme yetkisi vermez; yetki sunucuda denetlenir.
 */
export const operationGraphicLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ operationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: grant, error } = await supabaseAdmin.rpc("srv_operation_graphic", {
      _actor: context.userId,
      _operation_id: data.operationId,
    });
    if (error) throw new Error(error.message);

    const g = grant as { storage_path: string; filename: string; revision_no: number };
    const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(g.storage_path, 300);
    if (signed.error) throw new Error(signed.error.message);

    return { url: signed.data.signedUrl, filename: g.filename, revisionNo: g.revision_no };
  });
