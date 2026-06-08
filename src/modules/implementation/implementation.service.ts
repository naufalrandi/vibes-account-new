import { Op, type WhereOptions } from "sequelize";
import { ImplementationRecord, Organization } from "../../db/models";
import type { ImplementationModule } from "../../db/models/implementationRecord.model";
import { IMPLEMENTATION_MODULES, MODULE_PREFIX } from "../../db/models/implementationRecord.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateRecordInput {
  title: string;
  status?: string;
  owner?: string | null;
  data?: Record<string, unknown>;
}

export type UpdateRecordInput = Partial<CreateRecordInput>;

export interface RecordView {
  id: string;
  orgId: string;
  module: ImplementationModule;
  code: string;
  title: string;
  status: string;
  owner: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function isValidModule(m: string): m is ImplementationModule {
  return (IMPLEMENTATION_MODULES as string[]).includes(m);
}

function assertModule(m: string): ImplementationModule {
  if (!isValidModule(m)) throw new BadRequestError(`Unknown implementation module: ${m}`, "INVALID_MODULE");
  return m;
}

const RISK_BANDS: { max: number; level: string }[] = [
  { max: 3, level: "Negligible" },
  { max: 6, level: "Minor" },
  { max: 12, level: "Moderate" },
  { max: 18, level: "Major" },
  { max: 25, level: "Critical" },
];

/** Derive risk score/level from likelihood × impact so the register stays consistent. */
function enrich(module: ImplementationModule, data: Record<string, unknown>): Record<string, unknown> {
  if (module !== "risks") return data;
  const likelihood = Number(data.likelihood) || 0;
  const impact = Number(data.impact) || 0;
  const score = likelihood * impact;
  const level = score === 0 ? "" : (RISK_BANDS.find((b) => score <= b.max)?.level ?? "Critical");
  return { ...data, riskScore: score, riskLevel: level };
}

function toView(r: ImplementationRecord): RecordView {
  return {
    id: r.id,
    orgId: r.orgId,
    module: r.module,
    code: r.code,
    title: r.title,
    status: r.status,
    owner: r.owner,
    data: enrich(r.module, r.data),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Org ids the caller may act within. Returns null for SO (no filter). */
async function visibleOrgIds(auth: AuthContext): Promise<string[] | null> {
  if (auth.orgType === "ServiceOwner") return null;
  if (auth.orgType === "Distributor") {
    const tenants = await Organization.findAll({ where: { parentOrgId: auth.orgId, type: "Tenant" }, attributes: ["id"] });
    return [auth.orgId, ...tenants.map((t) => t.id)];
  }
  return [auth.orgId];
}

/** The org a write targets: tenants/distributors use their own org; SO must pass ?orgId. */
async function resolveTargetOrg(auth: AuthContext, orgId?: string): Promise<string> {
  if (auth.orgType === "ServiceOwner") {
    if (!orgId) throw new BadRequestError("orgId is required for the Service Owner", "ORG_REQUIRED");
    const org = await Organization.findByPk(orgId);
    if (!org || org.type !== "Tenant") throw new BadRequestError("orgId must reference a Tenant", "NOT_A_TENANT");
    return orgId;
  }
  return auth.orgId;
}

/** Next per-tenant code in the PREFIX-#### sequence for a module. */
async function nextCode(orgId: string, module: ImplementationModule): Promise<string> {
  const rows = await ImplementationRecord.findAll({ where: { orgId, module }, attributes: ["code"] });
  const prefix = MODULE_PREFIX[module];
  let max = 0;
  for (const r of rows) {
    const m = new RegExp(`${prefix}-(\\d+)`).exec(r.code || "");
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

export async function listRecords(auth: AuthContext, moduleRaw: string, orgId?: string): Promise<RecordView[]> {
  const module = assertModule(moduleRaw);
  const where: WhereOptions = { module };
  const ids = await visibleOrgIds(auth);
  if (ids) {
    if (ids.length === 0) return [];
    Object.assign(where, { orgId: { [Op.in]: orgId && ids.includes(orgId) ? [orgId] : ids } });
  } else if (orgId) {
    Object.assign(where, { orgId });
  }
  const rows = await ImplementationRecord.findAll({ where, order: [["code", "ASC"]] });
  return rows.map(toView);
}

async function requireVisible(auth: AuthContext, moduleRaw: string, id: string): Promise<ImplementationRecord> {
  const module = assertModule(moduleRaw);
  const row = await ImplementationRecord.findByPk(id);
  if (!row || row.module !== module) throw new NotFoundError("Record does not exist", "RECORD_NOT_FOUND");
  const ids = await visibleOrgIds(auth);
  if (ids && !ids.includes(row.orgId)) throw new NotFoundError("Record does not exist", "RECORD_NOT_FOUND");
  return row;
}

export async function getRecord(auth: AuthContext, moduleRaw: string, id: string): Promise<RecordView> {
  return toView(await requireVisible(auth, moduleRaw, id));
}

export async function createRecord(auth: AuthContext, moduleRaw: string, input: CreateRecordInput, orgId: string | undefined, ip: string | null): Promise<RecordView> {
  const module = assertModule(moduleRaw);
  if (auth.orgType === "Distributor") throw new ForbiddenError("Distributors cannot create implementation records");
  const targetOrg = await resolveTargetOrg(auth, orgId);
  const row = await ImplementationRecord.create({
    orgId: targetOrg,
    module,
    code: await nextCode(targetOrg, module),
    title: input.title,
    status: input.status ?? "Open",
    owner: input.owner ?? null,
    data: input.data ?? {},
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: targetOrg, tenantId: targetOrg, action: `implementation.${module}.created`, entityType: "ImplementationRecord", entityId: row.id, sourceIp: ip, result: "Success" });
  return toView(row);
}

export async function updateRecord(auth: AuthContext, moduleRaw: string, id: string, input: UpdateRecordInput, ip: string | null): Promise<RecordView> {
  if (auth.orgType === "Distributor") throw new ForbiddenError("Distributors cannot edit implementation records");
  const row = await requireVisible(auth, moduleRaw, id);
  if (input.title !== undefined) row.title = input.title;
  if (input.status !== undefined) row.status = input.status;
  if (input.owner !== undefined) row.owner = input.owner ?? null;
  if (input.data !== undefined) row.data = input.data;
  await row.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: row.orgId, tenantId: row.orgId, action: `implementation.${row.module}.updated`, entityType: "ImplementationRecord", entityId: row.id, sourceIp: ip, result: "Success" });
  return toView(row);
}

export async function deleteRecord(auth: AuthContext, moduleRaw: string, id: string, ip: string | null): Promise<void> {
  if (auth.orgType === "Distributor") throw new ForbiddenError("Distributors cannot delete implementation records");
  const row = await requireVisible(auth, moduleRaw, id);
  const { orgId, module } = row;
  await row.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: orgId, tenantId: orgId, action: `implementation.${module}.deleted`, entityType: "ImplementationRecord", entityId: id, sourceIp: ip, result: "Success" });
}
