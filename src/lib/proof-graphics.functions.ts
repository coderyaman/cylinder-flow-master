import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "grafik-pdf";

/**
 * Prova operatörüne yalnızca takımın siparişindeki güncel revizyonu açar.
 * Yetki sunucuda (Prova istasyonu kapsamı) denetlenir.
 */
export const proofGraphicLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ teamId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: grant, error } = await supabaseAdmin.rpc("srv_team_graphic", {
      _actor: context.userId,
      _team_id: data.teamId,
    });
    if (error) throw new Error(error.message);

    const g = grant as { storage_path: string; filename: string; revision_no: number };
    const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(g.storage_path, 300);
    if (signed.error) throw new Error(signed.error.message);

    return { url: signed.data.signedUrl, filename: g.filename, revisionNo: g.revision_no };
  });
