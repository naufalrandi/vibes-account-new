import { BusinessRecord } from "../../db/models";
import type { BusinessArea } from "../../db/models/businessRecord.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

export const BUSINESS_AREAS: BusinessArea[] = ["enterprise", "datana", "motoran", "exelera"];
export const OPERATING_COMPANIES = ["axia", "exelera"] as const;
export type OperatingCompany = typeof OPERATING_COMPANIES[number];

export interface BusinessRecordView {
  id: string;
  area: BusinessArea;
  module: string;
  code: string;
  title: string;
  status: string;
  owner: string | null;
  company: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BusinessInput {
  title?: string;
  status?: string;
  owner?: string | null;
  company?: string;
  data?: Record<string, unknown>;
}

function view(r: BusinessRecord): BusinessRecordView {
  return {
    id: r.id, area: r.area, module: r.module, code: r.code, title: r.title,
    status: r.status, owner: r.owner, company: r.company || "axia", data: r.data ?? {}, createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

function assertArea(area: string): asserts area is BusinessArea {
  if (!BUSINESS_AREAS.includes(area as BusinessArea)) throw new NotFoundError("Unknown business area", "AREA_NOT_FOUND");
}

function normalizeCompany(company?: string): OperatingCompany {
  if (!company) return "axia";
  const c = company.toLowerCase().trim();
  if (OPERATING_COMPANIES.includes(c as OperatingCompany)) return c as OperatingCompany;
  return "axia";
}

/**
 * Modules whose codes OD fixes explicitly rather than abbreviating. The Sales
 * entities all number from their own bases in OD (`leadNextId` index.html:29329,
 * `inqNextId` :29903, `propNextId` :30236, `prjNextId` :30389, `plNextId` :30513,
 * `sessNextId` :6253).
 */
interface BizCodeConfig {
  prefix: string;
  base: number;
  pad: number;
}

const BIZ_CODE_CONFIG: Record<string, BizCodeConfig> = {
  "ent-leads": { prefix: "LD", base: 2000, pad: 4 },
  "ent-leads-people": { prefix: "PL", base: 0, pad: 3 },
  "ent-inq": { prefix: "INQ", base: 3000, pad: 4 },
  "ent-proposals": { prefix: "PRO", base: 4000, pad: 4 },
  "ent-projects": { prefix: "PRJ", base: 6000, pad: 4 },
  "ent-training-sessions": { prefix: "SESS", base: 7000, pad: 4 },
};

/** Abbreviated code prefix from the module key (matches the design: `ent-personnel` → `PER`). */
function bizPrefix(module: string): string {
  const cfg = BIZ_CODE_CONFIG[module];
  if (cfg) return cfg.prefix;
  const seg = module.includes("-") ? module.slice(module.indexOf("-") + 1) : module;
  return seg.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3) || "REC";
}

async function nextCode(orgId: string, area: BusinessArea, module: string): Promise<string> {
  const cfg = BIZ_CODE_CONFIG[module];
  const prefix = cfg ? cfg.prefix : bizPrefix(module);
  const base = cfg ? cfg.base : 0;
  const pad = cfg ? cfg.pad : 4;
  const rows = await BusinessRecord.findAll({ where: { orgId, area, module }, attributes: ["code"] });
  let max = base;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(new RegExp(`^${prefix}-`), ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(pad, "0")}`;
}

export async function listBusiness(auth: AuthContext, area: string, module: string, company?: string): Promise<BusinessRecordView[]> {
  assertArea(area);
  const co = company ? normalizeCompany(company) : undefined;
  const where: Record<string, unknown> = { orgId: auth.orgId, area, module };
  if (co) where.company = co;
  const rows = await BusinessRecord.findAll({ where, order: [["createdAt", "DESC"]] });
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
    company: normalizeCompany(input.company),
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
  if (input.company !== undefined) r.company = normalizeCompany(input.company);
  if (input.data !== undefined) r.data = input.data;
  await r.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${area}.${module}.updated`, entityType: "BusinessRecord", entityId: r.id, sourceIp: ip, result: "Success" });
  return view(r);
}

/**
 * Server-side referential integrity guards (B-2):
 * - Refuse deleting a lead linked to a tenant workspace.
 * - Refuse deleting a lead with dependent inquiries or projects.
 */
async function assertDeletable(auth: AuthContext, area: BusinessArea, module: string, record: BusinessRecord): Promise<void> {
  if (area === "enterprise" && (module === "ent-leads" || module === "ent-leads-people")) {
    const data = (record.data || {}) as Record<string, unknown>;
    if (data.tenantId) {
      throw new BadRequestError("Tenant-linked lead — remove the tenant instead", "TENANT_LINKED_LEAD");
    }
    // Check for dependent inquiries and projects pointing at this lead (by code or id)
    const inqCount = await BusinessRecord.count({
      where: {
        orgId: auth.orgId,
        area: "enterprise",
        module: "ent-inq",
      },
    });
    const prjCount = await BusinessRecord.count({
      where: {
        orgId: auth.orgId,
        area: "enterprise",
        module: "ent-projects",
      },
    });

    if (inqCount > 0 || prjCount > 0) {
      const inqs = await BusinessRecord.findAll({
        where: { orgId: auth.orgId, area: "enterprise", module: "ent-inq" },
      });
      const prjs = await BusinessRecord.findAll({
        where: { orgId: auth.orgId, area: "enterprise", module: "ent-projects" },
      });
      const qs = inqs.filter((q) => {
        const d = (q.data || {}) as Record<string, unknown>;
        return d.leadId === record.code || d.leadId === record.id;
      }).length;
      const pr = prjs.filter((p) => {
        const d = (p.data || {}) as Record<string, unknown>;
        return d.leadId === record.code || d.leadId === record.id;
      }).length;

      if (qs > 0 || pr > 0) {
        throw new BadRequestError(`Has ${qs} inquiry(s) and ${pr} project(s) — cannot delete`, "LEAD_HAS_DEPENDENTS");
      }
    }
  }
}

export async function deleteBusiness(auth: AuthContext, area: string, module: string, id: string, ip: string | null): Promise<void> {
  assertArea(area);
  const r = await requireRecord(auth, area, module, id);
  await assertDeletable(auth, area, module, r);
  await r.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${area}.${module}.deleted`, entityType: "BusinessRecord", entityId: id, sourceIp: ip, result: "Success" });
}
