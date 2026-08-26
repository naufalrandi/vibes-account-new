import { Op, Model, type ModelStatic } from "sequelize";
import { PerfEval, User } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import type { PerfEvalIndicator } from "../../db/models/evaluation.models";
import { listRecords } from "../implementation/implementation.service";
import { listRisks } from "../risks/risk.service";
import { listFindings } from "../internal-audit/internalAudit.service";
import { computePerfIndicatorsBase, applyObjectiveOverrides, type PerfIndicator } from "./perfIndicators";

/**
 * Performance Evaluation (ISO 9.1). A single-entity register — each record is
 * an evaluation "snapshot" (period + indicator set + summary/conclusions).
 * The design mockup computes `indicators` live from ~14 other modules; here
 * they are user-entered/pasted structured data on create — that cross-module
 * live computation is out of scope (see issue description). Same thin
 * controller/service split as internal-audit.service.ts.
 */

async function actorName(auth: AuthContext): Promise<string> {
  const u = await User.findByPk(auth.userId);
  return u?.fullName ?? u?.username ?? "User";
}

async function targetOrg(auth: AuthContext, orgId?: string): Promise<string> {
  const org = orgId ?? auth.orgId;
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(org)) throw new ForbiddenError();
  return org;
}

async function orgWhere(auth: AuthContext, orgId?: string): Promise<Record<string, unknown>> {
  const ids = await visibleTenantOrgIds(auth);
  if (orgId) return { orgId: await targetOrg(auth, orgId) };
  if (ids !== null) return { orgId: { [Op.in]: ids } };
  return {};
}

async function nextCode(model: ModelStatic<Model>, prefix: string): Promise<string> {
  const rows = await model.findAll({ attributes: ["code"], where: { code: { [Op.like]: `${prefix}-%` } } });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(String(r.get("code")).slice(prefix.length + 1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

async function logAudit(auth: AuthContext, orgId: string, action: string, entityId: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: orgId, action, entityType: "PerfEval", entityId, sourceIp: ip, result: "Success" });
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v === "" ? "" : v == null ? null : String(v));

const INDICATOR_KEYS = ["name", "cat", "src", "unit", "dir", "target", "val", "status"] as const;

/** Loosely shapes each entry to the mockup's indicator snapshot fields; unknown extra keys are dropped. */
function parseIndicators(input: unknown): PerfEvalIndicator[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new BadRequestError("indicators must be an array", "INVALID_INDICATORS");
  return input.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) throw new BadRequestError(`indicators[${i}] must be an object`, "INVALID_INDICATORS");
    const rec = raw as Record<string, unknown>;
    const field = (k: (typeof INDICATOR_KEYS)[number]) => (typeof rec[k] === "string" ? rec[k] as string : rec[k] == null ? "" : String(rec[k]));
    return {
      name: field("name"), cat: field("cat"), src: field("src"), unit: field("unit"),
      dir: field("dir"), target: field("target"), val: field("val"), status: field("status"),
    };
  });
}

export async function listPerfEvals(auth: AuthContext, orgId?: string) {
  const where = await orgWhere(auth, orgId);
  return (await PerfEval.findAll({ where, order: [["date", "DESC"]] })).map((r) => r.get({ plain: true }));
}

export async function getPerfEval(auth: AuthContext, id: string) {
  const row = await PerfEval.findByPk(id);
  if (!row) throw new NotFoundError("Performance evaluation not found", "PERFEVAL_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  return row.get({ plain: true });
}

export async function createPerfEval(auth: AuthContext, input: Record<string, unknown>, orgId: string | undefined, ip: string | null) {
  const org = await targetOrg(auth, orgId);
  const period = str(input.period);
  const date = str(input.date);
  const owner = str(input.owner);
  if (!period) throw new BadRequestError("Evaluation period is required", "PERIOD_REQUIRED");
  if (!date) throw new BadRequestError("Evaluation date is required", "DATE_REQUIRED");
  if (!owner) throw new BadRequestError("Evaluator (owner) is required", "OWNER_REQUIRED");
  const indicators = parseIndicators(input.indicators);
  const who = await actorName(auth);
  const row = await PerfEval.create({
    orgId: org, code: await nextCode(PerfEval, "PEV"), period, date, owner,
    summary: str(input.summary), indicators, createdBy: who, lastUpdatedBy: who,
  });
  await logAudit(auth, org, "perfeval.created", row.id, ip);
  return row.get({ plain: true });
}

const PEV_STR_FIELDS = ["period", "date", "owner", "summary"] as const;

export async function updatePerfEval(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await PerfEval.findByPk(id);
  if (!row) throw new NotFoundError("Performance evaluation not found", "PERFEVAL_NOT_FOUND");
  await targetOrg(auth, row.orgId);
  const rec = row as unknown as Record<string, unknown>;
  for (const k of PEV_STR_FIELDS) {
    if (input[k] !== undefined) {
      const v = str(input[k]);
      if ((k === "period" || k === "date" || k === "owner") && !v) throw new BadRequestError(`${k} cannot be cleared`, "FIELD_REQUIRED");
      rec[k] = v;
    }
  }
  if (input.indicators !== undefined) row.indicators = parseIndicators(input.indicators);
  const who = await actorName(auth);
  row.lastUpdatedBy = who;
  await row.save();
  await logAudit(auth, row.orgId, "perfeval.updated", row.id, ip);
  return row.get({ plain: true });
}

/**
 * The 14 live ISO 9.1 indicators (`perfIndicators.ts`), computed from this
 * org's real collections. Single-org scoped (like the rest of this service)
 * rather than the multi-org `listRecords` default, so the numbers always
 * describe one tenant's register — the same scoping `perfEval.service.ts`
 * already uses for evaluation snapshots. Returned by `name`, then overlaid by
 * any linked `objectives` record (`source.kind: 'indicator'`) — OD's
 * `perfIndicators()`; see `applyObjectiveOverrides`.
 */
export async function getPerfIndicators(auth: AuthContext, orgId?: string): Promise<PerfIndicator[]> {
  const org = await targetOrg(auth, orgId);
  const [processes, risks, iaFindings, nonconformities, concerns, trainingPlans, awarenessCampaigns, internalDocuments, externalDocuments, suppliers, objectives] =
    await Promise.all([
      listRecords(auth, "processes", { orgId: org }),
      listRisks(auth, { orgId: org }),
      listFindings(auth, org),
      listRecords(auth, "nonconformities", { orgId: org }),
      listRecords(auth, "concerns", { orgId: org }),
      listRecords(auth, "training", { orgId: org }),
      listRecords(auth, "awareness-campaigns", { orgId: org }),
      listRecords(auth, "documents", { orgId: org }),
      listRecords(auth, "records", { orgId: org }),
      listRecords(auth, "suppliers", { orgId: org }),
      listRecords(auth, "objectives", { orgId: org }),
    ]);
  const base = computePerfIndicatorsBase({
    processes, risks, iaFindings, nonconformities, concerns, trainingPlans,
    awarenessCampaigns, internalDocuments, externalDocuments, suppliers,
  });
  return applyObjectiveOverrides(
    base,
    objectives.map((o) => ({
      id: o.id, title: o.title,
      source: (o.data?.source as { kind: string; indicator?: string } | null) ?? null,
      target: o.data?.target, dir: o.data?.dir,
    })),
  );
}
