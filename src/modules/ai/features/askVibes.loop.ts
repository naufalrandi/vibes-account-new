/**
 * Provider-neutral tool loop pieces for `ask-vibes.feature.ts`. Pure: no DB,
 * no AI — the tools and the permission check are passed in.
 *
 *   plan (model picks ≤ 4 tools) → run → answer (may ask for ≤ 4 more, once) → run → final answer
 */
import { z } from "zod";
import { jsonForPrompt, truncateForPrompt } from "./context";

export interface Citation {
  type: string;
  id: string;
  code?: string;
  label: string;
  /** App path when the source already knows it (deadline items). */
  link?: string;
}

export interface ToolResult {
  /** Compact JSON the model reads; every item carries a `ref` it can cite. */
  data: unknown;
  /** The citable records in `data`, keyed by their `ref`. */
  records: (Citation & { ref: string })[];
}

export interface AskTool<E> {
  description: string;
  args: z.ZodType;
  /** Any-of read permissions; without one the tool answers `{ denied: true }`. */
  permission: string[];
  run(args: never, env: E): Promise<ToolResult>;
}

export const MAX_CALLS = 4;
export const MAX_ROUNDS = 2;
const RESULT_CHARS = 6000;

export const toolCallSchema = z.object({
  tool: z.string(),
  args: z.record(z.string(), z.unknown()).nullish().transform((a) => a ?? {}),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const planSchema = z.object({ tools: z.array(toolCallSchema).default([]) });

export const answerSchema = z.object({
  answer: z.string().default(""),
  citations: z.array(z.string()).default([]),
  moreTools: z.array(toolCallSchema).default([]),
});

export interface Executed {
  tool: string;
  args: unknown;
  result: unknown;
  ok: boolean;
  records: ToolResult["records"];
}

/** The tool list shown to the model: name, what it returns, and its JSON args schema. */
export function toolCatalogue<E>(tools: Record<string, AskTool<E>>): string {
  return Object.entries(tools)
    .map(([name, t]) => `- ${name}: ${t.description} Args (JSON schema): ${JSON.stringify(z.toJSONSchema(t.args))}`)
    .join("\n");
}

/** Runs up to MAX_CALLS calls: unknown tool / bad args / missing permission become results, never throws for them. */
export async function runCalls<E>(
  tools: Record<string, AskTool<E>>, calls: ToolCall[], env: E, can: (permission: string[]) => boolean,
): Promise<Executed[]> {
  return Promise.all(calls.slice(0, MAX_CALLS).map(async ({ tool, args }): Promise<Executed> => {
    const def = Object.hasOwn(tools, tool) ? tools[tool] : undefined;
    const fail = (result: unknown): Executed => ({ tool, args, result, ok: false, records: [] });
    if (!def) return fail({ error: "unknown tool" });
    if (!can(def.permission)) return fail({ denied: true });
    const parsed = def.args.safeParse(args);
    if (!parsed.success) return fail({ error: "invalid arguments", issues: parsed.error.issues.map((i) => i.message).slice(0, 3) });
    try {
      const out = await def.run(parsed.data as never, env);
      return { tool, args: parsed.data, result: out.data, ok: true, records: out.records };
    } catch (e) {
      return fail({ error: e instanceof Error ? e.message.slice(0, 200) : "the tool failed" });
    }
  }));
}

export interface Turn { role: "user" | "assistant"; content: string }

/** Earlier turns (most recent last) plus the new question. */
export function transcript(history: Turn[], question: string): string {
  const past = history.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${truncateForPrompt(t.content, 1500)}`).join("\n\n");
  return [past ? `Conversation so far:\n${past}` : null, `Question: ${question}`].filter(Boolean).join("\n\n");
}

export function resultsForPrompt(executed: Executed[]): string {
  if (!executed.length) return "Tool results: none (no tool was run).";
  return `Tool results:\n${executed.map((e) => `## ${e.tool} ${JSON.stringify(e.args)}\n${jsonForPrompt(e.result, RESULT_CHARS)}`).join("\n\n")}`;
}

/** Cited refs → the records the tools actually returned; anything else is dropped. */
export function resolveCitations(cited: string[], executed: Executed[]): Citation[] {
  const byRef = new Map<string, Citation>();
  for (const e of executed) for (const { ref, ...c } of e.records) byRef.set(ref.toLowerCase(), c);
  const out = new Map<string, Citation>();
  for (const raw of cited) {
    const c = byRef.get(raw.replace(/[[\]]/g, "").trim().toLowerCase());
    if (c) out.set(`${c.type}:${c.id}`, c);
  }
  return [...out.values()];
}

export const toolsUsed = (executed: Executed[]): string[] => [...new Set(executed.filter((e) => e.ok).map((e) => e.tool))];
