import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { planSchema, resolveCitations, runCalls, toolCatalogue, toolsUsed, transcript, type AskTool } from "./askVibes.loop";

type Env = { orgId: string };

const tools: Record<string, AskTool<Env>> = {
  list_things: {
    description: "Things.",
    args: z.object({ status: z.string().optional() }),
    permission: ["ms.read"],
    run: vi.fn(async (args: { status?: string }, env: Env) => ({
      data: { items: [{ ref: "NC-1", status: args.status ?? "Open", org: env.orgId }] },
      records: [{ ref: "NC-1", type: "nonconformity", id: "id-1", code: "NC-1", label: "NC-1 — Leak" }],
    })),
  },
  secret: { description: "Needs audit.", args: z.object({}), permission: ["iaudit.read"], run: vi.fn() },
  broken: { description: "Throws.", args: z.object({}), permission: ["ms.read"], run: vi.fn(async () => { throw new Error("db down"); }) },
};

const can = (p: string[]) => p.includes("ms.read");

describe("ask-vibes loop", () => {
  it("lists tools with their JSON args schema", () => {
    const c = toolCatalogue(tools);
    expect(c).toContain("- list_things: Things. Args (JSON schema):");
    expect(c).toContain('"status"');
  });

  it("runs allowed calls and turns unknown / denied / invalid / failing ones into results", async () => {
    const out = await runCalls(tools, [
      { tool: "list_things", args: { status: "Closed" } },
      { tool: "secret", args: {} },
      { tool: "nope", args: {} },
      { tool: "list_things", args: { status: 5 } },
      { tool: "broken", args: {} }, // 5th call: over the limit, never run
    ], { orgId: "o1" }, can);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ ok: true, result: { items: [{ ref: "NC-1", status: "Closed", org: "o1" }] } });
    expect(out[1]).toMatchObject({ ok: false, result: { denied: true } });
    expect(tools.secret.run).not.toHaveBeenCalled();
    expect(out[2]).toMatchObject({ ok: false, result: { error: "unknown tool" } });
    expect(out[3]).toMatchObject({ ok: false, result: { error: "invalid arguments" } });
    expect(tools.broken.run).not.toHaveBeenCalled();
    expect(toolsUsed(out)).toEqual(["list_things"]);
  });

  it("reports a tool error instead of throwing", async () => {
    const [r] = await runCalls(tools, [{ tool: "broken", args: {} }], { orgId: "o1" }, can);
    expect(r).toMatchObject({ ok: false, result: { error: "db down" } });
  });

  it("does not resolve inherited object keys as tools", async () => {
    const [r] = await runCalls(tools, [{ tool: "toString", args: {} }], { orgId: "o1" }, can);
    expect(r.result).toEqual({ error: "unknown tool" });
  });

  it("resolves only cited refs that a tool returned", async () => {
    const executed = await runCalls(tools, [{ tool: "list_things", args: {} }], { orgId: "o1" }, can);
    expect(resolveCitations(["[nc-1]", "NC-1", "RSK-9"], executed)).toEqual([
      { type: "nonconformity", id: "id-1", code: "NC-1", label: "NC-1 — Leak" },
    ]);
  });

  it("accepts a null args object from the model", () => {
    expect(planSchema.parse({ tools: [{ tool: "risk_summary", args: null }] })).toEqual({ tools: [{ tool: "risk_summary", args: {} }] });
  });

  it("builds a transcript with history", () => {
    const t = transcript([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }], "What is overdue?");
    expect(t).toBe("Conversation so far:\nUser: hi\n\nAssistant: hello\n\nQuestion: What is overdue?");
  });
});
