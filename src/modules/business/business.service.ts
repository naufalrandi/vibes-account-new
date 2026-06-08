import { BusinessRecord, Organization } from "../../db/models";
import type { BusinessArea } from "../../db/models/businessRecord.model";
import { BUSINESS_AREAS } from "../../db/models/businessRecord.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateBusinessInput {
  title: string;
  status?: string;
  owner?: string | null;
  data?: Record<string, unknown>;
}

export type UpdateBusinessInput = Partial<CreateBusinessInput>;

export interface BusinessView {
  id: string;
  area: BusinessArea;
  module: string;
  code: string;
  title: string;
  status: string;
  owner: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Business Unit data is the operating company's internal records — Service Owner only. */
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner can access Business Unit data");
}

function assertArea(area: string): BusinessArea {
  if (!(BUSINESS_AREAS as string[]).includes(area)) throw new BadRequestError(`Unknown business area: ${area}`, "INVALID_AREA");
  return area as BusinessArea;
}

function assertModule(module: string): string {
  if (!module || !/^[a-z]+-[a-z]+$/i.test(module)) throw new BadRequestError(`Invalid module: ${module}`, "INVALID_MODULE");
  return module;
}

/** Derive a short code prefix from the module's significant segment (e.g. dn-pentest → PEN). */
function prefixFor(module: string): string {
  const seg = module.includes("-") ? module.slice(module.indexOf("-") + 1) : module;
  const alpha = seg.replace(/[^a-z]/gi, "").toUpperCase();
  return (alpha.slice(0, 3) || "REC");
}

function toView(r: BusinessRecord): BusinessView {
  return {
    id: r.id,
    area: r.area,
    module: r.module,
    code: r.code,
    title: r.title,
    status: r.status,
    owner: r.owner,
    data: r.data,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function nextCode(orgId: string, area: BusinessArea, module: string): Promise<string> {
  const rows = await BusinessRecord.findAll({ where: { orgId, area, module }, attributes: ["code"] });
  const prefix = prefixFor(module);
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

export async function listRecords(auth: AuthContext, areaRaw: string, moduleRaw: string): Promise<BusinessView[]> {
  assertServiceOwner(auth);
  const area = assertArea(areaRaw);
  const module = assertModule(moduleRaw);
  const rows = await BusinessRecord.findAll({ where: { orgId: auth.orgId, area, module }, order: [["code", "ASC"]] });
  return rows.map(toView);
}

async function requireOwned(auth: AuthContext, areaRaw: string, moduleRaw: string, id: string): Promise<BusinessRecord> {
  const area = assertArea(areaRaw);
  const module = assertModule(moduleRaw);
  const row = await BusinessRecord.findByPk(id);
  if (!row || row.area !== area || row.module !== module || row.orgId !== auth.orgId) {
    throw new NotFoundError("Record does not exist", "RECORD_NOT_FOUND");
  }
  return row;
}

export async function getRecord(auth: AuthContext, areaRaw: string, moduleRaw: string, id: string): Promise<BusinessView> {
  assertServiceOwner(auth);
  return toView(await requireOwned(auth, areaRaw, moduleRaw, id));
}

export async function createRecord(auth: AuthContext, areaRaw: string, moduleRaw: string, input: CreateBusinessInput, ip: string | null): Promise<BusinessView> {
  assertServiceOwner(auth);
  const area = assertArea(areaRaw);
  const module = assertModule(moduleRaw);
  const row = await BusinessRecord.create({
    orgId: auth.orgId,
    area,
    module,
    code: await nextCode(auth.orgId, area, module),
    title: input.title,
    status: input.status ?? "Open",
    owner: input.owner ?? null,
    data: input.data ?? {},
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${area}.${module}.created`, entityType: "BusinessRecord", entityId: row.id, sourceIp: ip, result: "Success" });
  return toView(row);
}

export async function updateRecord(auth: AuthContext, areaRaw: string, moduleRaw: string, id: string, input: UpdateBusinessInput, ip: string | null): Promise<BusinessView> {
  assertServiceOwner(auth);
  const row = await requireOwned(auth, areaRaw, moduleRaw, id);
  if (input.title !== undefined) row.title = input.title;
  if (input.status !== undefined) row.status = input.status;
  if (input.owner !== undefined) row.owner = input.owner ?? null;
  if (input.data !== undefined) row.data = input.data;
  await row.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${row.area}.${row.module}.updated`, entityType: "BusinessRecord", entityId: row.id, sourceIp: ip, result: "Success" });
  return toView(row);
}

export async function deleteRecord(auth: AuthContext, areaRaw: string, moduleRaw: string, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const row = await requireOwned(auth, areaRaw, moduleRaw, id);
  const { area, module } = row;
  await row.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${area}.${module}.deleted`, entityType: "BusinessRecord", entityId: id, sourceIp: ip, result: "Success" });
}
