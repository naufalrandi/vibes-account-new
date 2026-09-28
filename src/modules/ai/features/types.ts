import type { z } from "zod";
import type { AuthContext } from "../../../lib/scope";

/** What a generation is about, stored on its `ai_generations` row (e.g. { type: "risk", id: risk.id }). */
export interface AiTarget {
  type: string;
  id: string;
}

export interface AiCallRequest {
  /** Task-specific instructions. Language + the standard safety paragraph are appended for you. */
  system: string;
  /** The user turn: the task input plus any context (see context.ts helpers). */
  user: string;
  maxTokens?: number;
  target?: AiTarget;
}

export interface AiActionContext<I> {
  auth: AuthContext;
  ip: string | null;
  input: I;
  /** The caller org's language (Org Profile → System Defaults), e.g. "English". */
  language: string;
  /** Today (YYYY-MM-DD) in the caller org's timezone. */
  today: string;
  /** Every model call goes through here: it records an `ai_generations` row and an `ai.generation` audit entry. */
  ai: {
    json<T>(schema: z.ZodType<T>, req: AiCallRequest): Promise<{ data: T; generationId: string }>;
    text(req: AiCallRequest): Promise<{ text: string; generationId: string }>;
  };
  /** Job mode only: report progress (stored on the `ai_jobs` row, polled by the client). */
  progress?(done: number, total: number): Promise<void>;
}

export interface AiActionDef<I = unknown, O = unknown> {
  /** Any-of action keys (e.g. ACTIONS.RISK_UPDATE); "*" = any authenticated user. Super-admins always pass. */
  permission: string | string[];
  input: z.ZodType<I>;
  /** "sync" (default) answers in the request; "job" queues it for the worker and answers 202 { jobId }. */
  mode?: "sync" | "job";
  run(ctx: AiActionContext<I>): Promise<O>;
}

export interface AiScheduleDef {
  /** Globally unique, e.g. "<feature>:<task>". */
  key: string;
  everyMinutes: number;
  run(): Promise<void>;
}

export interface AiFeatureDef {
  /** Unique, kebab/camel case, ≤ 60 chars; also the file name: `<key>.feature.ts`. */
  key: string;
  label: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: Record<string, AiActionDef<any, any>>;
  schedules?: AiScheduleDef[];
}

/** Identity helpers that infer the input type from the zod schema. */
export const defineAction = <I, O>(def: AiActionDef<I, O>): AiActionDef<I, O> => def;
export const defineFeature = (def: AiFeatureDef): AiFeatureDef => def;
