import { z } from "zod";

export const aiRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("production") }).strict(),
  z.object({ kind: z.literal("quality"), recordId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("order"), recordId: z.string().uuid(), notes: z.string().trim().max(6000).default("") }).strict(),
]);
export type AiRequest = z.infer<typeof aiRequestSchema>;

export function canUseAi(kind: AiRequest["kind"], permissions: string[]): boolean {
  if (kind === "quality") return permissions.includes("rework.approve");
  if (kind === "order") return permissions.includes("orders.create");
  return permissions.includes("team.manage") || permissions.includes("production.release");
}