import { fn, col, literal, Op } from "sequelize";
import { AiFeatureFlag, AiGeneration, AiJob, Organization } from "../../../db/models";
import { isAiAvailable, platformOrgId } from "../../../lib/ai";
import { auditTenantId } from "../../../lib/auditTenant";
import { AiNotConfiguredError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { writeAudit } from "../../audit/audit.service";
import { resolveFlags, type FlagSource } from "./flags";
import { getFeature, listFeatures, loadFeatures } from "./registry";
import { hasActionPermission, runAction } from "./runtime";
import type { AiActionDef, AiFeatureDef } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FeatureView {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  /** Only the actions the caller may run. */
  actions: string[];
}

export async function listForCaller(auth: AuthContext): Promise<{ available: boolean; features: FeatureView[] }> {
  await loadFeatures();
  const features = listFeatures();
  const flags = await resolveFlags(auth.orgId, features.map((f) => f.key));
  return {
    available: await isAiAvailable(),
    features: features.map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description,
      enabled: flags.get(f.key)!.enabled,
      actions: Object.entries(f.actions).filter(([, a]) => hasActionPermission(auth, a.permission)).map(([k]) => k),
    })),
  };
}

/** The feature + action, after the 404 / 409 / 403 gates every invocation (API and worker) passes. */
export async function resolveAction(auth: AuthContext, featureKey: string, actionKey: string): Promise<{ feature: AiFeatureDef; def: AiActionDef }> {
  await loadFeatures();
  const feature = getFeature(featureKey);
  const def = feature && Object.hasOwn(feature.actions, actionKey) ? feature.actions[actionKey] : undefined;
  if (!feature || !def) throw new NotFoundError("Unknown AI feature or action", "AI_FEATURE_NOT_FOUND");
  if (!(await isAiAvailable())) throw new AiNotConfiguredError();
  if (!(await resolveFlags(auth.orgId, [feature.key])).get(feature.key)!.enabled) {
    throw new ForbiddenError("This AI feature is turned off for your organization", "AI_FEATURE_DISABLED");
  }
  if (!hasActionPermission(auth, def.permission)) throw new ForbiddenError("You do not have permission to use this AI action");
  return { feature, def };
}

export type InvokeResult = { status: 200; body: unknown } | { status: 202; body: { jobId: string } };

export async function invoke(auth: AuthContext, ip: string | null, featureKey: string, actionKey: string, body: unknown): Promise<InvokeResult> {
  const { feature, def } = await resolveAction(auth, featureKey, actionKey);
  const input = def.input.parse(body ?? {});
  if (def.mode === "job") {
    const job = await AiJob.create({
      orgId: auth.orgId, userId: auth.userId, feature: feature.key, action: actionKey,
      payload: input, total: null, result: null, error: null, lockedAt: null,
    });
    return { status: 202, body: { jobId: job.id } };
  }
  return { status: 200, body: await runAction({ feature: feature.key, action: actionKey, def, auth, ip, input }) };
}

export async function getJob(auth: AuthContext, id: string) {
  const job = UUID_RE.test(id) ? await AiJob.findOne({ where: { id, orgId: auth.orgId } }) : null;
  if (!job) throw new NotFoundError("AI job not found");
  return {
    id: job.id, feature: job.feature, action: job.action, status: job.status, progress: job.progress, total: job.total,
    result: job.result ?? null, error: job.error, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(),
  };
}

export async function setFeedback(auth: AuthContext, id: string, status: "accepted" | "edited" | "rejected"): Promise<{ ok: true }> {
  const gen = UUID_RE.test(id) ? await AiGeneration.findOne({ where: { id, orgId: auth.orgId } }) : null;
  if (!gen) throw new NotFoundError("AI generation not found");
  if (gen.status === "failed") throw new ConflictError("A failed generation has nothing to review");
  await gen.update({ status });
  return { ok: true };
}

export interface UsageRow {
  feature: string;
  generations: number;
  failed: number;
  accepted: number;
  edited: number;
  rejected: number;
  /** (accepted + edited) / reviewed, null until something was reviewed. */
  acceptRate: number | null;
  inputTokens: number;
  outputTokens: number;
}

const DAY_MS = 86_400_000;

export async function usage(auth: AuthContext, q: { from?: string; to?: string; orgId?: string }) {
  const orgId = q.orgId ?? auth.orgId;
  if (orgId !== auth.orgId && auth.orgType !== "ServiceOwner") throw new ForbiddenError("Usage of another organization is Service Owner only");
  const to = q.to ?? new Date().toISOString().slice(0, 10);
  const from = q.from ?? new Date(Date.parse(to) - 29 * DAY_MS).toISOString().slice(0, 10);
  if (from > to) throw new BadRequestError("`from` must not be after `to`");
  const count = (status: string) => fn("SUM", literal(`CASE WHEN status = '${status}' THEN 1 ELSE 0 END`));
  const rows = (await AiGeneration.findAll({
    where: { orgId, createdAt: { [Op.gte]: new Date(`${from}T00:00:00Z`), [Op.lt]: new Date(Date.parse(to) + DAY_MS) } },
    attributes: [
      "feature",
      [fn("COUNT", col("id")), "generations"],
      [count("failed"), "failed"],
      [count("accepted"), "accepted"],
      [count("edited"), "edited"],
      [count("rejected"), "rejected"],
      [fn("SUM", col("input_tokens")), "inputTokens"],
      [fn("SUM", col("output_tokens")), "outputTokens"],
    ],
    group: ["feature"],
    order: [["feature", "ASC"]],
    raw: true,
  })) as unknown as Record<string, string | number>[];
  const features: UsageRow[] = rows.map((r) => {
    const n = (k: string) => Number(r[k] ?? 0);
    const reviewed = n("accepted") + n("edited") + n("rejected");
    return {
      feature: String(r.feature), generations: n("generations"), failed: n("failed"), accepted: n("accepted"),
      edited: n("edited"), rejected: n("rejected"), acceptRate: reviewed ? (n("accepted") + n("edited")) / reviewed : null,
      inputTokens: n("inputTokens"), outputTokens: n("outputTokens"),
    };
  });
  return { orgId, from, to, features };
}

// ---- Feature flags (Service Owner) -------------------------------------------------------------

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("AI feature flags are managed by the Service Owner");
}

async function flagOrg(orgId: string | undefined): Promise<string> {
  const id = orgId ?? (await platformOrgId());
  if (!id) throw new ConflictError("No Service Owner organization exists");
  const org = UUID_RE.test(id) ? await Organization.findOne({ where: { id }, attributes: ["id"] }) : null;
  if (!org) throw new NotFoundError("Organization not found");
  return org.id;
}

export async function getFlags(auth: AuthContext, orgId?: string): Promise<{ feature: string; enabled: boolean; source: FlagSource }[]> {
  assertServiceOwner(auth);
  const id = await flagOrg(orgId);
  await loadFeatures();
  const keys = listFeatures().map((f) => f.key);
  const flags = await resolveFlags(id, keys);
  return keys.map((feature) => ({ feature, ...flags.get(feature)! }));
}

export async function setFlag(auth: AuthContext, ip: string | null, input: { orgId?: string; feature: string; enabled: boolean | null }) {
  assertServiceOwner(auth);
  const orgId = await flagOrg(input.orgId);
  await loadFeatures();
  if (!getFeature(input.feature)) throw new NotFoundError("Unknown AI feature", "AI_FEATURE_NOT_FOUND");
  if (input.enabled === null) {
    await AiFeatureFlag.destroy({ where: { orgId, feature: input.feature } });
  } else {
    const existing = await AiFeatureFlag.findOne({ where: { orgId, feature: input.feature } });
    if (existing) await existing.update({ enabled: input.enabled, updatedBy: auth.userId });
    else await AiFeatureFlag.create({ orgId, feature: input.feature, enabled: input.enabled, updatedBy: auth.userId });
  }
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: orgId,
    tenantId: auditTenantId(auth, orgId),
    action: "ai.feature_flag.updated",
    entityType: "AiFeatureFlag",
    entityId: null,
    sourceIp: ip,
    result: "Success",
    metadata: { feature: input.feature, enabled: input.enabled },
  });
  return getFlags(auth, orgId);
}
