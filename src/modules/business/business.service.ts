import { Op } from "sequelize";
import { BusinessRecord } from "../../db/models";
import type { BusinessArea } from "../../db/models/businessRecord.model";
import type { AuthContext } from "../../lib/scope";
import { sequelize } from "../../db/sequelize";
import { writeAudit } from "../audit/audit.service";
import { actorName } from "../record-events/recordEvent.service";
import { assertBusinessTransition, businessTransitionGraph } from "./prLifecycle";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors";

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

/** OD's own default operating company (app.html) — used ONLY when the caller genuinely omitted the parameter. */
function defaultCompany(): OperatingCompany {
  return "axia";
}

/**
 * Validates a non-empty company string. Unlike the old `normalizeCompany`,
 * this never silently coerces garbage input to `'axia'` — an unrecognized
 * value is a client error (C-4), not a tenancy default.
 */
function validateCompany(company: string): OperatingCompany {
  const c = company.toLowerCase().trim();
  if (OPERATING_COMPANIES.includes(c as OperatingCompany)) return c as OperatingCompany;
  throw new BadRequestError(`Unknown operating company: ${company}`, "INVALID_COMPANY");
}

/**
 * Resolves a caller-supplied company value: absent/blank → OD's default
 * ('axia'); present but garbage → 400 INVALID_COMPANY. Never resolves an
 * absent company to "no filter" (C-2) — every call site must go through
 * this (or `validateCompany` directly) rather than reading `company`
 * un-normalized.
 */
function resolveCompany(company?: string): OperatingCompany {
  if (!company || !company.trim()) return defaultCompany();
  return validateCompany(company);
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

interface LeadIdentity {
  legalName: string;
  orgType: string;
  country: string;
}

/**
 * OD `leadLegalNameOf` (app.html:29325): older/legacy leads predate the
 * required Legal name field, so the display name is the fallback when
 * comparing. Mirrored here as legal name → `data.company` (OD's `l.company`,
 * the lead's display/trading name) → `title` (this backend's always-present
 * display field).
 */
function leadIdentityOf(data: Record<string, unknown> | undefined, title: string): LeadIdentity {
  const d = data || {};
  const legal = (d.legal && typeof d.legal === "object" ? d.legal : {}) as Record<string, unknown>;
  const legalName = String(legal.legalName || d.company || title || "").trim();
  const orgType = String(legal.orgType || "").trim();
  const country = String(d.country || "").trim();
  return { legalName, orgType, country };
}

/**
 * Server-side lead duplicate guard (BE-10). OD's uniqueness key for a Lead is
 * legal name + organization type + country, not the display name alone: "a CV
 * and a PT may legitimately share a name, and so may entities registered in
 * different countries" (app.html:29334-29338). Scoped by the active operating
 * company — AXIA and Exelera keep separate pools.
 *
 * This lives inside createBusiness/updateBusiness, the single generic
 * entrypoint every `ent-leads` write goes through — including any
 * inquiry-creates-lead-on-the-fly path this backend might grow — so the guard
 * cannot be bypassed by a different write path (OD's own comment at
 * app.html:29337: "Inquiries can create leads on the fly (inqForm), so
 * duplicates arrive without anyone typing them").
 */
async function assertNoDuplicateLead(
  auth: AuthContext,
  company: OperatingCompany,
  data: Record<string, unknown> | undefined,
  title: string,
  excludeId?: string,
): Promise<void> {
  const identity = leadIdentityOf(data, title);
  if (!identity.legalName) return;

  const where: Record<string, unknown> = {
    orgId: auth.orgId,
    area: "enterprise",
    module: "ent-leads",
    company,
    // Pushes the comparison into Postgres (JSONB path extraction + the same
    // fallback chain as leadIdentityOf) instead of pulling every lead into
    // app memory to filter in JS. The 0059 migration adds a matching partial
    // expression index on business_records for this exact predicate.
    [Op.and]: sequelize.literal(
      `lower(COALESCE(NULLIF(data#>>'{legal,legalName}', ''), NULLIF(data->>'company', ''), title)) = :leadLegalName
       AND COALESCE(data#>>'{legal,orgType}', '') = :leadOrgType
       AND COALESCE(data->>'country', '') = :leadCountry`,
    ),
  };
  if (excludeId) where.id = { [Op.ne]: excludeId };

  const dup = await BusinessRecord.findOne({
    where,
    replacements: {
      leadLegalName: identity.legalName.toLowerCase(),
      leadOrgType: identity.orgType,
      leadCountry: identity.country,
    },
  });
  if (dup) {
    throw new ConflictError(
      `Already registered as ${dup.code} — ${identity.orgType} ${identity.legalName}`,
      "DUPLICATE_LEAD",
    );
  }
}

/** Fields BE-4's `?sort=` may order by — a fixed allowlist, never the raw query value, avoids SQL injection via ORDER BY. */
const SORTABLE_FIELDS = ["createdAt", "updatedAt", "title", "status", "code"] as const;
type SortableField = typeof SORTABLE_FIELDS[number];

function isSortableField(field: string): field is SortableField {
  return (SORTABLE_FIELDS as readonly string[]).includes(field);
}

/** BE-4: `?sort=field` or `?sort=field:asc|desc`. Unknown/absent field falls back to `createdAt DESC`. */
function parseSort(sort?: string): [string, string][] {
  if (!sort) return [["createdAt", "DESC"]];
  const [fieldRaw, dirRaw] = sort.split(":");
  const field: SortableField = isSortableField(fieldRaw) ? fieldRaw : "createdAt";
  const dir = dirRaw?.toLowerCase() === "asc" ? "ASC" : "DESC";
  return [[field, dir]];
}

export interface BusinessListFilters {
  q?: string;
  status?: string;
  owner?: string;
  sort?: string;
}

export async function listBusiness(
  auth: AuthContext,
  area: string,
  module: string,
  company?: string,
  filters: BusinessListFilters = {},
): Promise<BusinessRecordView[]> {
  assertArea(area);
  const co = resolveCompany(company); // always resolves — absent company means 'axia', never "no filter" (C-2)
  const where: Record<string, unknown> = { orgId: auth.orgId, area, module, company: co };
  if (filters.status && filters.status.trim()) where.status = filters.status.trim();
  if (filters.owner && filters.owner.trim()) where.owner = filters.owner.trim();
  if (filters.q && filters.q.trim()) where.title = { [Op.iLike]: `%${filters.q.trim()}%` };
  const rows = await BusinessRecord.findAll({ where, order: parseSort(filters.sort) });
  return rows.map(view);
}

async function requireRecord(auth: AuthContext, area: BusinessArea, module: string, id: string, company: OperatingCompany): Promise<BusinessRecord> {
  const r = await BusinessRecord.findOne({ where: { id, orgId: auth.orgId, area, module, company } });
  if (!r) throw new NotFoundError("Record does not exist", "RECORD_NOT_FOUND");
  return r;
}

/** Newest-first `{ts,user,action,summary}` activity trail, nested in `data.activity` — this
 *  project's standing "nest child records in JSONB" convention (mirrors `lib/procurement/
 *  suppliers.ts`'s `appendSupplierActivity` on the FE). Only modules with a `BUSINESS_TRANSITIONS`
 *  entry (see `prLifecycle.ts`) get this server-authored guarantee; every other business module
 *  keeps composing its own `data.activity` client-side exactly as it already does. */
function hasActivity(data: Record<string, unknown>): boolean {
  return Array.isArray(data.activity) && data.activity.length > 0;
}

export async function createBusiness(auth: AuthContext, area: string, module: string, input: BusinessInput, ip: string | null): Promise<BusinessRecordView> {
  assertArea(area);
  if (!input.title || !input.title.trim()) throw new BadRequestError("Title is required", "TITLE_REQUIRED");
  const title = input.title.trim();
  const company = resolveCompany(input.company);
  let data = input.data ?? {};
  if (area === "enterprise" && module === "ent-leads") {
    await assertNoDuplicateLead(auth, company, data, title);
  }
  // Guarantees a transitions-gated record is never created with an empty activity trail, even
  // if a caller bypasses the FE's own "created ..." entry (see `hasActivity`'s header note).
  if (businessTransitionGraph(area, module) && !hasActivity(data)) {
    const who = (await actorName(auth)) ?? "Unknown user";
    data = { ...data, activity: [{ ts: new Date().toISOString(), user: who, action: "Record created", summary: "" }] };
  }
  const r = await BusinessRecord.create({
    orgId: auth.orgId, area, module,
    code: await nextCode(auth.orgId, area, module),
    title,
    status: input.status?.trim() || "Open",
    owner: input.owner ?? null,
    company,
    data,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${area}.${module}.created`, entityType: "BusinessRecord", entityId: r.id, sourceIp: ip, result: "Success" });
  return view(r);
}

export async function updateBusiness(auth: AuthContext, area: string, module: string, id: string, input: BusinessInput, ip: string | null, company?: string): Promise<BusinessRecordView> {
  assertArea(area);
  const co = resolveCompany(company);
  const r = await requireRecord(auth, area, module, id, co);
  const prevStatus = r.status;
  const prevActivity = Array.isArray((r.data as Record<string, unknown> | null)?.activity) ? ((r.data as Record<string, unknown>).activity as unknown[]) : [];
  if (input.title !== undefined) {
    if (!input.title.trim()) throw new BadRequestError("Title is required", "TITLE_REQUIRED");
    r.title = input.title.trim();
  }
  if (input.status !== undefined) {
    // BE-5: server-side transition validation, scoped to the Business Unit modules registered
    // in `prLifecycle.ts`'s `BUSINESS_TRANSITIONS` (currently `enterprise/ent-pr` — the Purchase
    // Requests workflow: role-gated and financially consequential, so this is real enforcement,
    // not just a client-side gate). Every other business module keeps accepting any status,
    // exactly as before — `assertBusinessTransition` no-ops when the module has no registered graph.
    const nextStatus = input.status.trim() || r.status;
    assertBusinessTransition(area, module, r.status, nextStatus);
    r.status = nextStatus;
  }
  if (input.owner !== undefined) r.owner = input.owner;
  // C-5: company is set once at creation and never mutated. OD has no
  // "move company" action; a client cannot relocate a record across the
  // tenancy boundary after the fact. `input.company` is intentionally
  // ignored here (silent no-op), matching how other unrecognized/irrelevant
  // fields on this same payload are already handled.
  if (input.data !== undefined) r.data = input.data;
  if (area === "enterprise" && module === "ent-leads") {
    await assertNoDuplicateLead(auth, r.company as OperatingCompany, r.data, r.title, r.id);
  }

  // Activity-trail append, scoped the same way transition validation is (see comment above).
  // Only a *fallback*: if the caller's own `data.activity` already grew (the FE composes a
  // rich, action-specific entry itself — see `lib/procurement/purchaseRequests.ts`'s transition
  // builders), this does nothing, so the normal path never double-logs.
  const statusChanged = input.status !== undefined && r.status !== prevStatus;
  if (businessTransitionGraph(area, module) && statusChanged) {
    const nextData = (r.data ?? {}) as Record<string, unknown>;
    const nextActivity = Array.isArray(nextData.activity) ? (nextData.activity as unknown[]) : [];
    if (nextActivity.length <= prevActivity.length) {
      const who = (await actorName(auth)) ?? "Unknown user";
      const entry = { ts: new Date().toISOString(), user: who, action: `Status changed: ${prevStatus} → ${r.status}`, summary: "" };
      r.data = { ...nextData, activity: [entry, ...nextActivity] };
    }
  }

  await r.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${area}.${module}.updated`, entityType: "BusinessRecord", entityId: r.id, sourceIp: ip, result: "Success" });
  return view(r);
}

/**
 * Server-side referential integrity guards (B-2):
 * - Refuse deleting a lead linked to a tenant workspace.
 * - Refuse deleting a lead with dependent inquiries or projects.
 *
 * `ent-leads-people` (person leads) is deliberately NOT gated here (B-3). OD's
 * `plDelete` (app.html:30599) carries zero referential guard — it always
 * deletes unconditionally, with only an informational confirm-dialog note
 * ("Inquiries already converted from this person are not affected"). That's
 * because `plConvert` (app.html:30600) stamps the resulting inquiry with
 * `leadId:''` — a person-lead-derived inquiry never actually references the
 * person lead's id/code, so there is nothing for a dependent-count guard to
 * find, and applying the `ent-leads` guard here would silently diverge from
 * OD the moment that reference shape ever changes.
 */
async function assertDeletable(auth: AuthContext, area: BusinessArea, module: string, record: BusinessRecord): Promise<void> {
  if (area === "enterprise" && module === "ent-leads") {
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

export async function deleteBusiness(auth: AuthContext, area: string, module: string, id: string, ip: string | null, company?: string): Promise<void> {
  assertArea(area);
  const co = resolveCompany(company);
  const r = await requireRecord(auth, area, module, id, co);
  await assertDeletable(auth, area, module, r);
  await r.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${area}.${module}.deleted`, entityType: "BusinessRecord", entityId: id, sourceIp: ip, result: "Success" });
}
