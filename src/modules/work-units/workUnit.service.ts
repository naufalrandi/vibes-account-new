import { WorkUnit } from "../../db/models/workUnit.model";
import { Site } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

export const WU_STATUSES = ["Applicable", "Inapplicable", "Archived"] as const;

export interface WorkUnitView {
  id: string;
  code: string;
  name: string;
  siteId: string | null;
  status: string;
  description: string | null;
  processIds: string[];
  envIds: string[];
  depIds: string[];
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkUnitInput {
  name?: string;
  siteId?: string | null;
  status?: string;
  description?: string | null;
  processIds?: string[];
  envIds?: string[];
  depIds?: string[];
}

function view(w: WorkUnit): WorkUnitView {
  return {
    id: w.id, code: w.code, name: w.name, siteId: w.siteId, status: w.status, description: w.description,
    processIds: w.processIds ?? [], envIds: w.envIds ?? [], depIds: w.depIds ?? [],
    createdBy: w.createdBy, createdAt: w.createdAt, updatedAt: w.updatedAt,
  };
}

function assertStatus(status: string) {
  if (!WU_STATUSES.includes(status as (typeof WU_STATUSES)[number])) {
    throw new BadRequestError(`Invalid status "${status}"`, "INVALID_STATUS");
  }
}

/** A supplied site must belong to the caller's organization. */
async function assertSite(orgId: string, siteId: string | null | undefined): Promise<void> {
  if (!siteId) return;
  const site = await Site.findOne({ where: { id: siteId, orgId } });
  if (!site) throw new BadRequestError("Site does not belong to this organization", "INVALID_SITE");
}

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

async function nextCode(orgId: string): Promise<string> {
  const rows = await WorkUnit.findAll({ where: { orgId }, attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^WKU-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `WKU-${String(max + 1).padStart(4, "0")}`;
}

async function actorName(auth: AuthContext): Promise<string | null> {
  return auth.userId ? auth.userId : null;
}

export async function listWorkUnits(auth: AuthContext): Promise<WorkUnitView[]> {
  const rows = await WorkUnit.findAll({ where: { orgId: auth.orgId }, order: [["createdAt", "DESC"]] });
  return rows.map(view);
}

async function requireWorkUnit(auth: AuthContext, id: string): Promise<WorkUnit> {
  const w = await WorkUnit.findOne({ where: { id, orgId: auth.orgId } });
  if (!w) throw new NotFoundError("Work unit does not exist", "WORK_UNIT_NOT_FOUND");
  return w;
}

export async function createWorkUnit(auth: AuthContext, input: WorkUnitInput, ip: string | null): Promise<WorkUnitView> {
  if (!input.name || !input.name.trim()) throw new BadRequestError("Name is required", "NAME_REQUIRED");
  const status = input.status?.trim() || "Applicable";
  assertStatus(status);
  await assertSite(auth.orgId, input.siteId);
  const w = await WorkUnit.create({
    orgId: auth.orgId,
    code: await nextCode(auth.orgId),
    name: input.name.trim(),
    siteId: input.siteId ?? null,
    status,
    description: input.description ?? null,
    processIds: arr(input.processIds),
    envIds: arr(input.envIds),
    depIds: arr(input.depIds),
    createdBy: await actorName(auth),
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "workUnit.created", entityType: "WorkUnit", entityId: w.id, sourceIp: ip, result: "Success" });
  return view(w);
}

export async function updateWorkUnit(auth: AuthContext, id: string, input: WorkUnitInput, ip: string | null): Promise<WorkUnitView> {
  const w = await requireWorkUnit(auth, id);
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new BadRequestError("Name is required", "NAME_REQUIRED");
    w.name = input.name.trim();
  }
  if (input.status !== undefined) { assertStatus(input.status); w.status = input.status; }
  if (input.siteId !== undefined) { await assertSite(auth.orgId, input.siteId); w.siteId = input.siteId; }
  if (input.description !== undefined) w.description = input.description;
  if (input.processIds !== undefined) w.processIds = arr(input.processIds);
  if (input.envIds !== undefined) w.envIds = arr(input.envIds);
  if (input.depIds !== undefined) w.depIds = arr(input.depIds);
  await w.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "workUnit.updated", entityType: "WorkUnit", entityId: w.id, sourceIp: ip, result: "Success" });
  return view(w);
}

/** Soft-delete: OD archives work units rather than destroying them. */
export async function archiveWorkUnit(auth: AuthContext, id: string, ip: string | null): Promise<WorkUnitView> {
  const w = await requireWorkUnit(auth, id);
  w.status = "Archived";
  await w.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "workUnit.archived", entityType: "WorkUnit", entityId: w.id, sourceIp: ip, result: "Success" });
  return view(w);
}
