import { AiGeneration, Organization } from "../../../db/models";
import { aiComplete } from "../../../lib/ai";
import { aiCompleteJson } from "../../../lib/ai/json";
import { auditTenantId } from "../../../lib/auditTenant";
import { AppError } from "../../../lib/errors";
import { todayInTz, DEFAULT_TZ } from "../../../lib/localDate";
import type { AuthContext } from "../../../lib/scope";
import { writeAudit } from "../../audit/audit.service";
import type { AiActionContext, AiActionDef, AiCallRequest } from "./types";

/**
 * Runs a feature action: the one place that builds an AiActionContext, for the
 * API (sync actions) and the worker (job actions) alike.
 */

const DEFAULT_LANGUAGE = "English";

export const SAFETY_PARAGRAPH =
  "Your output is a draft that a person will review before anything is saved. " +
  "Base it only on the context provided. When you rely on a provided source, cite it by its id in square brackets, e.g. [id]. " +
  "Never invent clause numbers, record codes, names, dates or figures that are not present in the context. " +
  "If information needed for a good answer is missing, say what is missing instead of guessing.";

export function buildSystemPrompt(system: string, language: string): string {
  return `${system.trim()}\n\nWrite in ${language}.\n\n${SAFETY_PARAGRAPH}`;
}

/** Any-of permission check; "*" = any authenticated user; super-admins always pass. */
export function hasActionPermission(auth: AuthContext, permission: string | string[]): boolean {
  const keys = Array.isArray(permission) ? permission : [permission];
  return auth.isSuperAdmin || keys.includes("*") || keys.some((k) => auth.actions.includes(k));
}

const errorMessage = (e: unknown) => (e instanceof AppError ? e.message : "The AI request failed");

interface RunOptions<I> {
  feature: string;
  action: string;
  def: AiActionDef<I, unknown>;
  auth: AuthContext;
  ip: string | null;
  input: I;
  progress?: AiActionContext<I>["progress"];
}

export async function runAction<I>(opts: RunOptions<I>): Promise<unknown> {
  const { auth, ip, feature, action } = opts;
  const org = await Organization.findOne({ where: { id: auth.orgId }, attributes: ["id", "systemDefaults"] });
  const language = org?.systemDefaults?.language || DEFAULT_LANGUAGE;
  const today = todayInTz(org?.systemDefaults?.timezone || DEFAULT_TZ);

  interface CallResult { model: string; provider: string; usage: { inputTokens: number; outputTokens: number }; latencyMs: number }

  /** Make the call and record it: an ai_generations row (draft, or failed) plus an `ai.generation` audit entry. */
  async function record<R extends CallResult>(req: AiCallRequest, call: () => Promise<R>): Promise<{ res: R; generationId: string }> {
    const base = {
      orgId: auth.orgId, userId: auth.userId, feature, action,
      targetType: req.target?.type ?? null, targetId: req.target?.id ?? null,
    };
    const audit = (gen: AiGeneration, result: "Success" | "Failure") =>
      writeAudit({
        actorUserId: auth.userId,
        organizationId: auth.orgId,
        tenantId: auditTenantId(auth, auth.orgId),
        action: "ai.generation",
        entityType: "AiGeneration",
        entityId: gen.id,
        sourceIp: ip,
        result,
        metadata: { feature, action, model: gen.model, generationId: gen.id },
      });
    let res: R;
    try {
      res = await call();
    } catch (e) {
      const gen = await AiGeneration.create({
        ...base, provider: null, model: null, latencyMs: null, status: "failed", error: errorMessage(e),
      });
      await audit(gen, "Failure");
      throw e;
    }
    const gen = await AiGeneration.create({
      ...base, provider: res.provider, model: res.model, inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens, latencyMs: res.latencyMs, status: "draft", error: null,
    });
    await audit(gen, "Success");
    return { res, generationId: gen.id };
  }

  const ctx: AiActionContext<I> = {
    auth, ip, input: opts.input, language, today, progress: opts.progress,
    ai: {
      async json(schema, req) {
        const messages = [{ role: "user" as const, content: req.user }];
        const { res, generationId } = await record(req, () =>
          aiCompleteJson(schema, { system: buildSystemPrompt(req.system, language), messages, maxTokens: req.maxTokens }),
        );
        return { data: res.data, generationId };
      },
      async text(req) {
        const messages = [{ role: "user" as const, content: req.user }];
        const { res, generationId } = await record(req, () =>
          aiComplete({ system: buildSystemPrompt(req.system, language), messages, maxTokens: req.maxTokens }),
        );
        return { text: res.text, generationId };
      },
    },
  };
  return opts.def.run(ctx);
}
