import { Op, type WhereOptions } from "sequelize";
import { ImplementationRecord } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { MS_MODULES, isMsModule, enrichData } from "./registry";

export interface RecordView {
  id: string;
  orgId: string;
  module: string;
  code: string;
  title: string;
  status: string;
  owner: string | null;
  data: Record<string, unknown>;
  elementId: string | null;
  frameworks: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordInput {
  title?: string;
  status?: string;
  owner?: string | null;
  data?: Record<string, unknown>;
  elementId?: string | null;
  frameworks?: string[];
}

function view(r: ImplementationRecord): RecordView {
  return {
    id: r.id, orgId: r.orgId, module: r.module, code: r.code, title: r.title,
    status: r.status, owner: r.owner, data: r.data ?? {}, elementId: r.elementId,
    frameworks: r.frameworks ?? [], createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function requireModule(module: string) {
  if (!isMsModule(module)) throw new NotFoundError("Unknown register module", "MODULE_NOT_FOUND");
  return MS_MODULES[module];
}

function assertStatus(module: string, status: string) {
  const def = MS_MODULES[module];
  if (!def.statuses.includes(status)) {
    throw new BadRequestError(`Invalid status "${status}" for ${module}`, "INVALID_STATUS");
  }
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

async function nextCode(module: string): Promise<string> {
  const { prefix } = MS_MODULES[module];
  const rows = await ImplementationRecord.findAll({ where: { module }, attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(new RegExp(`^${prefix}-`), ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

export async function listRecords(auth: AuthContext, module: string, filters: { orgId?: string } = {}): Promise<RecordView[]> {
  requireModule(module);
  const where: WhereOptions = { module };
  const ids = await visibleTenantOrgIds(auth);
  if (filters.orgId) {
    await assertCanSeeOrg(auth, filters.orgId);
    Object.assign(where, { orgId: filters.orgId });
  } else if (ids !== null) {
    Object.assign(where, { orgId: { [Op.in]: ids } });
  }
  const rows = await ImplementationRecord.findAll({ where, order: [["createdAt", "DESC"]] });
  return rows.map(view);
}

async function requireRecord(auth: AuthContext, module: string, id: string): Promise<ImplementationRecord> {
  requireModule(module);
  const r = await ImplementationRecord.findOne({ where: { id, module } });
  if (!r) throw new NotFoundError("Record does not exist", "RECORD_NOT_FOUND");
  await assertCanSeeOrg(auth, r.orgId);
  return r;
}

export async function createRecord(auth: AuthContext, module: string, input: RecordInput, orgId: string | undefined, ip: string | null): Promise<RecordView> {
  const def = requireModule(module);
  const targetOrg = orgId ?? auth.orgId;
  await assertCanSeeOrg(auth, targetOrg);
  if (!input.title || !input.title.trim()) throw new BadRequestError("Title is required", "TITLE_REQUIRED");
  const status = input.status ?? def.statuses[0];
  assertStatus(module, status);
  const r = await ImplementationRecord.create({
    orgId: targetOrg,
    module,
    code: await nextCode(module),
    title: input.title.trim(),
    status,
    owner: input.owner ?? null,
    data: enrichData(module, input.data ?? {}),
    elementId: input.elementId ?? null,
    frameworks: input.frameworks ?? [],
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: targetOrg,
    action: `ms.${module}.created`, entityType: "ImplementationRecord", entityId: r.id, sourceIp: ip, result: "Success",
  });
  return view(r);
}

export async function updateRecord(auth: AuthContext, module: string, id: string, input: RecordInput, ip: string | null): Promise<RecordView> {
  const r = await requireRecord(auth, module, id);
  if (input.title !== undefined) r.title = input.title.trim();
  if (input.status !== undefined) {
    assertStatus(module, input.status);
    r.status = input.status;
  }
  if (input.owner !== undefined) r.owner = input.owner;
  if (input.data !== undefined) r.data = enrichData(module, input.data);
  if (input.elementId !== undefined) r.elementId = input.elementId;
  if (input.frameworks !== undefined) r.frameworks = input.frameworks;
  await r.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: r.orgId,
    action: `ms.${module}.updated`, entityType: "ImplementationRecord", entityId: r.id, sourceIp: ip, result: "Success",
  });
  return view(r);
}

export async function deleteRecord(auth: AuthContext, module: string, id: string, ip: string | null): Promise<void> {
  const r = await requireRecord(auth, module, id);
  const orgId = r.orgId;
  await r.destroy();
  await writeAudit({
    actorUserId: auth.userId, organizationId: orgId,
    action: `ms.${module}.deleted`, entityType: "ImplementationRecord", entityId: id, sourceIp: ip, result: "Success",
  });
}
