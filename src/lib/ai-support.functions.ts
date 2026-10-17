import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aiRequestSchema } from "@/lib/ai-policy";

export const generateAiSupport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => aiRequestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { handleAiSupport } = await import("@/lib/ai/support.server");
    return handleAiSupport(data, context.supabase, context.userId, getRequest());
  });