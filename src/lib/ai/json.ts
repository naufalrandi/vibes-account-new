/**
 * Structured output on top of `aiComplete`, for both providers, without any
 * provider-specific structured-output feature:
 *
 *   const { data } = await aiCompleteJson(z.object({ title: z.string() }), { system, messages });
 *
 * The JSON Schema of `schema` is appended to the system prompt, the reply is
 * extracted (code fences / leading prose stripped, first {...} or [...] block)
 * and validated. One retry carries the validation error back to the model;
 * after that it throws AiProviderError("The AI returned an invalid response").
 */
import { z } from "zod";
import { AiProviderError } from "../errors";
import { aiComplete, type AiMessage, type AiProviderName } from "./index";

export interface AiJsonRequest {
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
}

export interface AiJsonResult<T> {
  data: T;
  text: string;
  model: string;
  provider: AiProviderName;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

const ERROR_DETAIL_MAX = 1500;

export function jsonInstruction(schema: z.ZodType): string {
  const jsonSchema = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  return (
    "Reply with ONLY a single JSON value that matches this JSON Schema. " +
    "No prose, no explanations, no markdown code fences.\n" +
    JSON.stringify(jsonSchema)
  );
}

/** The first balanced {...} or [...] block in `text` (fences and prose around it ignored), or null. */
export function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[{[]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

/** Parsed + validated value, or the error to feed back to the model. */
function parseReply<T>(schema: z.ZodType<T>, text: string): { ok: true; data: T } | { ok: false; error: string } {
  const raw = extractJson(text);
  if (raw === null) return { ok: false, error: "The reply contained no JSON object or array." };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `The reply was not valid JSON: ${(e as Error).message}` };
  }
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, error: z.prettifyError(parsed.error).slice(0, ERROR_DETAIL_MAX) };
}

export async function aiCompleteJson<T>(schema: z.ZodType<T>, req: AiJsonRequest): Promise<AiJsonResult<T>> {
  const system = `${req.system}\n\n${jsonInstruction(schema)}`;
  const usage = { inputTokens: 0, outputTokens: 0 };
  let latencyMs = 0;
  let messages = req.messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await aiComplete({ system, messages, maxTokens: req.maxTokens });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    latencyMs += res.latencyMs;
    const parsed = parseReply(schema, res.text);
    if (parsed.ok) return { data: parsed.data, text: res.text, model: res.model, provider: res.provider, usage, latencyMs };
    messages = [
      ...req.messages,
      { role: "assistant", content: res.text },
      { role: "user", content: `Your reply was invalid:\n${parsed.error}\nReply again with ONLY the corrected JSON value.` },
    ];
  }
  throw new AiProviderError("The AI returned an invalid response");
}
