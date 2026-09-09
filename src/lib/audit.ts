import { supabase } from "@/integrations/supabase/client";

type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
};

/**
 * Denetim kaydı yalnızca eklenebilir. Hiçbir rol bu kaydı güncelleyemez veya silemez.
 */
export async function writeAudit(input: AuditInput) {
  const { data } = await supabase.auth.getUser();
  const actorId = data.user?.id;
  if (!actorId) return;

  const { error } = await supabase.from("audit_log").insert({
    actor_id: actorId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    old_value: (input.oldValue ?? null) as never,
    new_value: (input.newValue ?? null) as never,
    reason: input.reason ?? null,
  });

  if (error) console.error("Denetim kaydı yazılamadı", error);
}
