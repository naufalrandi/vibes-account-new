import { BusinessRecord } from "../../db/models";
import type { BusinessArea } from "../../db/models/businessRecord.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

export const BUSINESS_AREAS: BusinessArea[] = ["enterprise", "datana", "motoran", "exelera"];

export interface BusinessRecordView {
  id: string;
  area: BusinessArea;
  module: string;
  code: string;
  title: string;
  status: string;
  owner: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BusinessInput {
  title?: string;
  status?: string;
  owner?: string | null;
  data?: Record<string, unknown>;
}

function view(r: BusinessRecord): BusinessRecordView {
  return {
    id: r.id, area: r.area, module: r.module, code: r.code, title: r.title,
    status: r.status, owner: r.owner, data: r.data ?? {}, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function assertArea(area: string): asserts area is BusinessArea {
  if (!BUSINESS_AREAS.includes(area as BusinessArea)) throw new NotFoundError("Unknown business area", "AREA_NOT_FOUND");
}

/**
 * Modules whose codes OD fixes explicitly rather than abbreviating. The Sales
 * entities all number from their own bases in OD (`leadNextId` index.html:29329,
 * `inqNextId` :29903, `propNextId` :30236, `prjNextId` :30389, `plNextId` :30513),
 * and the derived abbreviation would give the wrong stem for every one of them
 * (`ent-leads` → "LEA", `ent-proposals`/`ent-projects` → both "PRO").
 */
const BIZ_PREFIX_OVERRIDE: Record<string, string> = {
  "ent-leads": "LD",
  "ent-leads-people": "PL",
  "ent-inq": "INQ",
  "ent-proposals": "PRO",
  "ent-projects": "PRJ",
};

/** Abbreviated code prefix from the module key (matches the design: `ent-personnel` → `PER`). */
function bizPrefix(module: string): string {
  const override = BIZ_PREFIX_OVERRIDE[module];
  if (override) return override;
  const seg = module.includes("-") ? module.slice(module.indexOf("-") + 1) : module;
  return seg.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3) || "REC";
}

async function nextCode(orgId: string, area: BusinessArea, module: string): Promise<string> {
  const prefix = bizPrefix(module);
  const rows = await BusinessRecord.findAll({ where: { orgId, area, module }, attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(new RegExp(`^${prefix}-`), ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

export async function listBusiness(auth: AuthContext, area: string, module: string): Promise<BusinessRecordView[]> {
  assertArea(area);
  const rows = await BusinessRecord.findAll({ where: { orgId: auth.orgId, area, module }, order: [["createdAt", "DESC"]] });
  return rows.map(view);
}

async function requireRecord(auth: AuthContext, area: BusinessArea, module: string, id: string): Promise<BusinessRecord> {
  const r = await BusinessRecord.findOne({ where: { id, orgId: auth.orgId, area, module } });
  if (!r) throw new NotFoundError("Record does not exist", "RECORD_NOT_FOUND");
  return r;
}

export async function createBusiness(auth: AuthContext, area: string, module: string, input: BusinessInput, ip: string | null): Promise<BusinessRecordView> {
  assertArea(area);
  if (!input.title || !input.title.trim()) throw new BadRequestError("Title is required", "TITLE_REQUIRED");
  const r = await BusinessRecord.create({
    orgId: auth.orgId, area, module,
    code: await nextCode(auth.orgId, area, module),
    title: input.title.trim(),
    status: input.status?.trim() || "Open",
    owner: input.owner ?? null,
    data: input.data ?? {},
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${area}.${module}.created`, entityType: "BusinessRecord", entityId: r.id, sourceIp: ip, result: "Success" });
  return view(r);
}

export async function updateBusiness(auth: AuthContext, area: string, module: string, id: string, input: BusinessInput, ip: string | null): Promise<BusinessRecordView> {
  assertArea(area);
  const r = await requireRecord(auth, area, module, id);
  if (input.title !== undefined) {
    if (!input.title.trim()) throw new BadRequestError("Title is required", "TITLE_REQUIRED");
    r.title = input.title.trim();
  }
  if (input.status !== undefined) r.status = input.status.trim() || r.status;
  if (input.owner !== undefined) r.owner = input.owner;
  if (input.data !== undefined) r.data = input.data;
  await r.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${area}.${module}.updated`, entityType: "BusinessRecord", entityId: r.id, sourceIp: ip, result: "Success" });
  return view(r);
}

export async function deleteBusiness(auth: AuthContext, area: string, module: string, id: string, ip: string | null): Promise<void> {
  assertArea(area);
  const r = await requireRecord(auth, area, module, id);
  await r.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${area}.${module}.deleted`, entityType: "BusinessRecord", entityId: id, sourceIp: ip, result: "Success" });
}
