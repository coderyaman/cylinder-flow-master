import { describe, expect, test } from "bun:test";
import { aiRequestSchema, canUseAi } from "../src/lib/ai-policy";

describe("Read-only AI authorization", () => {
  test("production requires production authority", () => {
    expect(canUseAi("production", ["production.release"])).toBe(true);
    expect(canUseAi("production", ["operation.start"])).toBe(false);
  });
  test("quality support requires manager decision authority", () => {
    expect(canUseAi("quality", ["rework.approve"])).toBe(true);
    expect(canUseAi("quality", ["operation.start"])).toBe(false);
  });
  test("order checklist requires order preparation authority", () => {
    expect(canUseAi("order", ["orders.create"])).toBe(true);
    expect(canUseAi("order", ["inventory.receive"])).toBe(false);
  });
  test("requests reject mutation commands", () => {
    expect(aiRequestSchema.safeParse({ kind: "quality", recordId: "00000000-0000-4000-8000-000000000001", decision: "devam" }).success).toBe(false);
    expect(aiRequestSchema.safeParse({ kind: "production", removeBlock: true }).success).toBe(false);
  });
});