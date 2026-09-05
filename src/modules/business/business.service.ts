import { Op } from "sequelize";
import { BusinessRecord } from "../../db/models";
import type { BusinessArea } from "../../db/models/businessRecord.model";
import type { AuthContext } from "../../lib/scope";
import { sequelize } from "../../db/sequelize";
import { writeAudit } from "../audit/audit.service";
import { actorName } from "../record-events/recordEvent.service";
import { assertBusinessTransition, businessDefaultStatus, businessTransitionGraph } from "./prLifecycle";
import { applyPoConfirmToken, PO_AREA, PO_MODULE } from "./poConfirmation";
import { assertValidInquiryData } from "./inquiryRules";
import { assertValidProposalData } from "./proposalRules";
import {
  DN_BACKLOG,
  DN_CLIENTS,
  DN_ENGAGEMENTS,
  DN_FINDINGS,
  DN_PROJECTS,
  assertValidDatanaData,
  assertValidDatanaStatus,
  datanaDefaultStatus,
  isDatanaModule,
} from "./datanaRules";
import {
  cabAuditDays, cabCertManDays, cabComplexityAdj, cabInitialDays, cabSampleSize, canIssueCertificate,
  CAB_RATE_DEFAULT, type CabAuditType, type CabComplexityLevel, type CabNcGrade,
} from "./cabPricing";
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
export function resolveCompany(company?: string): OperatingCompany {
  if (!company || !company.trim()) return defaultCompany();
  return validateCompany(company);
}

/**
 * Modules whose codes OD fixes explicitly rather than abbreviating. The Sales
 * entities all number from their own bases in OD (`leadNextId` app.html:29312,
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
  // Datana (`js/datana.js`'s `dnSeedIfNeeded`, ipPad prefixes DNC-/PT-/VF-/SD-/BL-, pad 4).
  [DN_CLIENTS]: { prefix: "DNC", base: 0, pad: 4 },
  [DN_ENGAGEMENTS]: { prefix: "PT", base: 0, pad: 4 },
  [DN_FINDINGS]: { prefix: "VF", base: 0, pad: 4 },
  [DN_PROJECTS]: { prefix: "SD", base: 0, pad: 4 },
  [DN_BACKLOG]: { prefix: "BL", base: 0, pad: 4 },
  // SOF-25: modules that already have a `prLifecycle.ts` transition graph
  // (PR/PO) or a live FE page posting to the generic business endpoint, but
  // were still falling back to `bizPrefix`'s generic 3-letter guess. `ent-pr`/
  // `ent-po` keep the same prefix `bizPrefix` already derived (no behavior
  // change, just an explicit contract per prLifecycle.ts's own note that they
  // "still lack a BIZ_CODE_CONFIG entry"). `ex-cab`/`mb-vehicle`/`mb-booking`/
  // `mb-support` carry OD's own real numbering (`cabNextId` core.js:3950,
  // `ipPad(db.mbVehicles/mbBookings/mbTickets,...)` motoran.js:14/23/30). The
  // rest (`ent-comp`, `ent-payroll`, `ent-minwage`, `ent-db-courses`,
  // `ent-ctypes`/`ent-svc-ctypes`/`ent-sup-ctypes`, `ent-ss`) had no
  // sequential OD scheme to preserve (OD minted them with `rUid`/fixed
  // seeds), so these prefixes are new, chosen to read like the rest of this
  // table rather than invent a numbering OD never had.
  "ent-pr": { prefix: "PR", base: 0, pad: 4 },
  "ent-po": { prefix: "PO", base: 0, pad: 4 },
  "ex-cab": { prefix: "CB", base: 1000, pad: 0 },
  "mb-vehicle": { prefix: "MB", base: 0, pad: 4 },
  "mb-booking": { prefix: "BK", base: 0, pad: 4 },
  "mb-support": { prefix: "TK", base: 0, pad: 4 },
  "ent-comp": { prefix: "COMP", base: 0, pad: 4 },
  "ent-payroll": { prefix: "PY", base: 0, pad: 0 },
  "ent-minwage": { prefix: "MW", base: 0, pad: 4 },
  "ent-db-courses": { prefix: "CRS", base: 0, pad: 4 },
  "ent-ctypes": { prefix: "CT", base: 0, pad: 3 },
  "ent-svc-ctypes": { prefix: "SCT", base: 0, pad: 3 },
  "ent-sup-ctypes": { prefix: "PCT", base: 0, pad: 3 },
  "ent-ss": { prefix: "SS", base: 0, pad: 4 },
  // SOF-25, second batch. Numbering read off the design's own `*NextId` helpers, so a ported
  // record keeps the id an OD user would recognise:
  //   `scNextId` modules.js:2643 — SC-5001 up
  //   `leaveNextId` modules.js:3467 — LV-4001 up
  //   `holidayNextId` modules.js:1345 — HOL-6001 up
  //   `bankNextId` modules.js:1379 — BNK-9001 up
  "ent-svc-contracts": { prefix: "SC", base: 5000, pad: 0 },
  "ent-leave": { prefix: "LV", base: 4000, pad: 0 },
  "ent-holidays": { prefix: "HOL", base: 6000, pad: 0 },
  "ent-banks": { prefix: "BNK", base: 9000, pad: 0 },
  // The rest have no counter in the design to preserve — OD mints them as hand-written slugs
  // (`cd-qs`, `ctp-id-perm`, `ct-perm`) or, for PO standard terms, as a seeded clause array with
  // no id field at all (`poTermsStd` modules.js:4144). A slug is not portable to a multi-tenant
  // table where two tenants may both define "Quality and Safety", so these get this table's own
  // sequential scheme rather than a slug generator OD only got away with because its seed list
  // was fixed.
  "ent-po-terms": { prefix: "POT", base: 0, pad: 3 },
  "ent-ctype-profiles": { prefix: "CTP", base: 0, pad: 3 },
  "ent-ctype-templates": { prefix: "CTT", base: 0, pad: 3 },
  // `db.clauses` — the reusable clause library `contractTemplates`/`contractDocs`
  // snapshot from. No OD counter to preserve (`rUid`-seeded), same as `ent-ctypes`.
  "ent-clauses": { prefix: "CL", base: 0, pad: 3 },
  "ent-db-disciplines": { prefix: "CD", base: 0, pad: 3 },
  // `fiscalGen` (modules.js:2856) mints `FP-<fy>-01..12` — the fiscal year is part of the id, a
  // shape `BizCodeConfig`'s prefix/base/pad cannot express and not worth generalising the whole
  // table for one module. The FY lives in `data.fy`; the code stays a plain per-tenant sequence.
  "ent-fiscal": { prefix: "FP", base: 0, pad: 2 },
  // SOF-25, third batch — Exelera scope datasets (`fe-vibes-new/docs/modules/12-scope-datasets-demo.md`)
  // that back Work Unit's Environments/Dependencies/Personnel-Type pickers. Design ids are real
  // sequences (`design-registry.json`: `spEnvs`→SDENV-0001, `spDeps`→SDDEP-0001, `spPtypes`→SDPT-0001),
  // ported verbatim. `groups` (Standards/Regulations, used by `ex-cab`'s standards picker) mints its
  // id with `rUid` in OD (`grp_<random>`, `03-data-model.md:24`) — no counter to preserve, so it gets
  // this table's own sequential scheme like `ent-po-terms`'s bucket above.
  "ex-sp-envs": { prefix: "SDENV", base: 0, pad: 4 },
  "ex-sp-deps": { prefix: "SDDEP", base: 0, pad: 4 },
  "ex-sp-ptypes": { prefix: "SDPT", base: 0, pad: 4 },
  "ex-groups": { prefix: "GRP", base: 0, pad: 3 },
};

/**
 * `enterprise/ent-recruitment` (SOF-25) is one `business_records` module
 * carrying two OD collections (`db.jobOpenings`/`db.candidates`,
 * `lib/platform/recruitment.ts`'s header note), told apart by
 * `data.entity === "candidate"`. OD numbers each from its own base
 * (`modules.js:5641` `JOB-`/1000, `modules.js:5724` `CAN-`/2000) — a single
 * `BIZ_CODE_CONFIG[module]` entry can't express that split, so `nextCode`
 * below special-cases this one module the same way `createBusiness` already
 * special-cases it by `module` for validation.
 */
const RECRUITMENT_OPENING_CFG: BizCodeConfig = { prefix: "JOB", base: 1000, pad: 0 };
const RECRUITMENT_CANDIDATE_CFG: BizCodeConfig = { prefix: "CAN", base: 2000, pad: 0 };

/** Abbreviated code prefix from the module key (matches the design: `ent-personnel` → `PER`). */
function bizPrefix(module: string): string {
  const cfg = BIZ_CODE_CONFIG[module];
  if (cfg) return cfg.prefix;
  const seg = module.includes("-") ? module.slice(module.indexOf("-") + 1) : module;
  return seg.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3) || "REC";
}

/**
 * Exported (SOF-38 business-records seeder) so `businessRecordsSeed.ts` can mint the exact same
 * codes a live `createBusiness` call would have produced, instead of re-deriving the
 * prefix/base/pad scheme a second time — see `BIZ_CODE_CONFIG`'s header note.
 */
export async function nextCode(orgId: string, area: BusinessArea, module: string, data?: Record<string, unknown>): Promise<string> {
  const cfg = module === "ent-recruitment"
    ? (data?.entity === "candidate" ? RECRUITMENT_CANDIDATE_CFG : RECRUITMENT_OPENING_CFG)
    : BIZ_CODE_CONFIG[module];
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
/**
 * OD `certProposalStart` (js/modules.js:2219) opens with
 * `if(!q||!q.ar||q.ar.status!=='Approved')return;` — an auto-priced certification proposal
 * may only be raised once the inquiry's Application Review has cleared the AR-Manager gate.
 *
 * `assertValidCertInput` only checks that the man-day inputs are well-shaped, so before this
 * any payload carrying `data.cert` was auto-priced at the certification rate regardless of
 * whether the review had been approved — the commercial gate was absent, not merely lenient.
 */
async function assertCertProposalApproved(
  auth: AuthContext,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const d = data ?? {};
  if (d.cert === undefined) return;

  const inqId = typeof d.inqId === "string" ? d.inqId.trim() : "";
  if (!inqId) {
    throw new BadRequestError(
      "An auto-priced certification proposal must reference the inquiry it was reviewed under (inqId)",
      "CERT_PROPOSAL_INQUIRY_REQUIRED",
    );
  }

  const inquiry = await BusinessRecord.findOne({
    where: { orgId: auth.orgId, area: "enterprise", module: "ent-inq", id: inqId },
  });
  const ar = (inquiry?.data as { ar?: { status?: unknown } } | undefined)?.ar;
  if (!inquiry || !ar || String(ar.status ?? "") !== "Approved") {
    throw new BadRequestError(
      "The inquiry's Application Review must be Approved before a certification proposal can be auto-priced",
      "CERT_PROPOSAL_AR_NOT_APPROVED",
    );
  }
}

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
  if (area === "enterprise" && module === "ent-inq") {
    assertValidInquiryData(data);
  }
  if (area === "enterprise" && module === "ent-proposals") {
    await assertCertProposalApproved(auth, data);
    data = assertValidProposalData(data, { isCreate: true });
  }
  if (area === "datana" && isDatanaModule(module)) {
    data = assertValidDatanaData(module, data);
  }
  if (area === PO_AREA && module === PO_MODULE) {
    // `confirmToken` authenticates the public supplier link, so the server owns
    // it — a client-supplied value is discarded, never trusted.
    data = applyPoConfirmToken(null, data, input.status ?? "");
  }
  // Guarantees a transitions-gated record is never created with an empty activity trail, even
  // if a caller bypasses the FE's own "created ..." entry (see `hasActivity`'s header note).
  if (businessTransitionGraph(area, module) && !hasActivity(data)) {
    const who = (await actorName(auth)) ?? "Unknown user";
    data = { ...data, activity: [{ ts: new Date().toISOString(), user: who, action: "Record created", summary: "" }] };
  }
  // Datana has no server-enforced transition graph (see datanaRules.ts header) — just its own
  // per-module status vocabulary and default, in place of the generic "Open" (only coincidentally
  // valid for dn-findings; wrong for the other four modules).
  const status = input.status?.trim()
    || businessDefaultStatus(area, module)
    || (area === "datana" ? datanaDefaultStatus(module) : undefined)
    || "Open";
  // A graph-gated module's create is the one status write `updateBusiness`'s
  // `assertBusinessTransition` never sees, so validate the *vocabulary* here — otherwise a client
  // could post `status: "Approved"` straight into a Leave request and skip the whole graph.
  const createGraph = businessTransitionGraph(area, module);
  if (createGraph && !(status in createGraph)) {
    throw new BadRequestError(`"${status}" is not a valid initial status for a ${module} record`, "INVALID_STATUS");
  }
  if (area === "datana") assertValidDatanaStatus(module, status);
  const r = await BusinessRecord.create({
    orgId: auth.orgId, area, module,
    code: await nextCode(auth.orgId, area, module, data),
    title,
    status,
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
  const prevData = (r.data ?? {}) as Record<string, unknown>;
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
    if (area === "datana") assertValidDatanaStatus(module, nextStatus);
    r.status = nextStatus;
  }
  if (input.owner !== undefined) r.owner = input.owner;
  // C-5: company is set once at creation and never mutated. OD has no
  // "move company" action; a client cannot relocate a record across the
  // tenancy boundary after the fact. `input.company` is intentionally
  // ignored here (silent no-op), matching how other unrecognized/irrelevant
  // fields on this same payload are already handled.
  if (input.data !== undefined) r.data = input.data;
  if (area === PO_AREA && module === PO_MODULE) {
    // Server-owned: a live supplier link is never rotated or overwritten by a
    // client, and a token is minted the first time the PO is actually sent.
    r.data = applyPoConfirmToken(prevData, (r.data ?? {}) as Record<string, unknown>, r.status);
  }
  if (area === "enterprise" && module === "ent-leads") {
    await assertNoDuplicateLead(auth, r.company as OperatingCompany, r.data, r.title, r.id);
  }
  if (area === "enterprise" && module === "ent-inq") {
    assertValidInquiryData(r.data as Record<string, unknown> | undefined);
  }
  if (area === "enterprise" && module === "ent-proposals") {
    r.data = assertValidProposalData(r.data as Record<string, unknown> | undefined);
  }
  if (area === "datana" && isDatanaModule(module)) {
    r.data = assertValidDatanaData(module, r.data as Record<string, unknown> | undefined);
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

/**
 * AXI-44: server-enforced Proposal → Project conversion (`enterprise/ent-projects`), mirroring
 * OD's `projectConvert`/`propCardHtml`'s "Convert to project" affordance (modules.js ~L2519,
 * ~L2664) but — unlike OD's client-only `sc.status==='Signed'` gate — actually enforced here so a
 * client cannot fabricate a Planned project against a Draft/Rejected proposal by posting straight
 * to the generic `POST /:area/:module` create endpoint. The authoritative fields (lead, service,
 * variant, currency, value) are read from the proposal's own server-computed `data`, never from
 * the caller's payload, the same "server never trusts client totals" posture `proposalRules.ts`
 * takes for `data.totals` itself. `input.data`/`input.title` may only ADD fields (e.g. the FE's
 * milestone-template scaffolding) — they can never override the fields listed above.
 */
export async function createProjectFromProposal(
  auth: AuthContext,
  proposalId: string,
  input: BusinessInput,
  ip: string | null,
  company?: string,
): Promise<BusinessRecordView> {
  const co = resolveCompany(company);
  const proposal = await requireRecord(auth, "enterprise", "ent-proposals", proposalId, co);
  if (proposal.status !== "Accepted") {
    throw new BadRequestError("Only an Accepted proposal can be converted into a project", "PROPOSAL_NOT_ACCEPTED");
  }
  const pData = (proposal.data || {}) as Record<string, unknown>;

  const siblings = await BusinessRecord.findAll({ where: { orgId: auth.orgId, area: "enterprise", module: "ent-projects", company: co } });
  if (siblings.some((p) => (p.data as Record<string, unknown> | null)?.proposalId === proposal.id)) {
    throw new ConflictError(`A project already exists for ${proposal.code}`, "PROJECT_ALREADY_EXISTS");
  }

  const totals = (pData.totals || {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {
    ...(input.data ?? {}),
    proposalId: proposal.id,
    proposalCode: proposal.code,
    leadId: pData.leadId ?? null,
    leadName: pData.leadName ?? null,
    service: pData.service ?? null,
    variant: pData.variant ?? null,
    currency: pData.currency ?? null,
    totalValue: Number(totals.total ?? 0),
  };
  const title = input.title?.trim() || `Project · ${String(pData.leadName ?? proposal.title)}`;

  const r = await sequelize.transaction(async (tx) => {
    const created = await BusinessRecord.create({
      orgId: auth.orgId, area: "enterprise", module: "ent-projects",
      code: await nextCode(auth.orgId, "enterprise", "ent-projects"),
      title, status: "Planned", owner: null, company: co, data,
    }, { transaction: tx });
    proposal.data = { ...pData, projectId: created.id };
    await proposal.save({ transaction: tx });
    return created;
  });

  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "business.enterprise.ent-projects.created_from_proposal", entityType: "BusinessRecord", entityId: r.id, sourceIp: ip, result: "Success" });
  return view(r);
}

export async function deleteBusiness(auth: AuthContext, area: string, module: string, id: string, ip: string | null, company?: string): Promise<void> {
  assertArea(area);
  const co = resolveCompany(company);
  const r = await requireRecord(auth, area, module, id, co);
  await assertDeletable(auth, area, module, r);
  await r.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: `business.${area}.${module}.deleted`, entityType: "BusinessRecord", entityId: id, sourceIp: ip, result: "Success" });
}

/**
 * Exelera CAB (`exelera/ex-cab`) man-day pricing — server-computes and persists the audit-time
 * fields OD's `cabProgrammeView`/`cabApplicationReviewView` compute client-side (core.js
 * `cabInitialDays`/`cabAuditDays`/`cabSample`, ported at `cabPricing.ts`), so a client can no
 * longer post a fabricated man-day/price figure the way a Proposal's `totals` could before AXI-43
 * (see `proposalRules.ts`'s header note — same "server never trusts client totals" posture).
 *
 * `data.standards` (string[]), `data.personnel` (effective headcount) and `data.sites` (site
 * count) drive the math; `data.complexity` (`Record<standard, 'Low'|'Standard'|'High'>`) is
 * optional (defaults every standard to `'Standard'`, i.e. adj 0). `auditType` selects which
 * man-day figure (`cabAuditDays`) and IAF MD 1 sample size (`cabSampleSize`) to compute for —
 * defaults to `'Stage 1'` (the first audit of a new application) when omitted.
 */
export async function priceCabClient(
  auth: AuthContext,
  id: string,
  auditType: CabAuditType | undefined,
  ip: string | null,
  company?: string,
): Promise<BusinessRecordView> {
  const co = resolveCompany(company);
  const r = await requireRecord(auth, "exelera", "ex-cab", id, co);
  const data = (r.data || {}) as Record<string, unknown>;
  const standards = Array.isArray(data.standards) ? (data.standards as string[]) : [];
  const personnel = Number(data.personnel) || 1;
  const sites = Number(data.sites) || 1;
  const complexity = (data.complexity || {}) as Record<string, CabComplexityLevel>;
  const type: CabAuditType = auditType || "Stage 1";

  const adj = cabComplexityAdj(standards, complexity);
  const days = type === "Stage 1" || type === "Stage 2"
    ? cabAuditDays(type, personnel, standards, adj)
    : cabCertManDays(personnel, standards, adj).total; // Surveillance/Recert priced on the same funnel total as a proposal.
  const initialAuditDays = cabInitialDays(personnel, standards, adj);
  const sample = cabSampleSize(sites, type);

  const pricing = {
    auditType: type, adj, days, initialAuditDays, sample, sites,
    ratePerMd: CAB_RATE_DEFAULT, price: days * CAB_RATE_DEFAULT,
    computedAt: new Date().toISOString(),
  };
  r.data = { ...data, pricing };
  await r.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "business.exelera.ex-cab.priced", entityType: "BusinessRecord", entityId: r.id, sourceIp: ip, result: "Success" });
  return view(r);
}

/**
 * Certificate issuance gate for an Exelera CAB client (`cabDecision('grant')`/`cabIssueCert`,
 * core.js:4102/3996): blocked while any `data.findings[]` entry is an OPEN Major nonconformity
 * (open Minor/OFI findings do not block). Cert id follows this backend's own code-numbering
 * convention (`nextCode`/`BIZ_CODE_CONFIG` above) rather than inventing a new counter — the CAB
 * client's own record `code` (e.g. `CB-1007`) supplies the number, mirroring OD's own
 * `certNo='EXL-'+id.replace('CB-','')+'-'+year` derivation from the client's own id.
 */
export async function issueCabCertificate(auth: AuthContext, id: string, ip: string | null, company?: string): Promise<BusinessRecordView> {
  const co = resolveCompany(company);
  const r = await requireRecord(auth, "exelera", "ex-cab", id, co);
  const data = (r.data || {}) as Record<string, unknown>;
  const findings = (Array.isArray(data.findings) ? data.findings : []) as { grade?: string; open?: boolean }[];
  if (!canIssueCertificate(findings.map((f) => ({ grade: (f.grade as CabNcGrade) || "Minor", open: !!f.open })))) {
    throw new ConflictError("Cannot issue a certificate while a Major nonconformity is open", "OPEN_MAJOR_NC");
  }
  const num = r.code.replace(/^[A-Z]+-/, "").replace(/^0+(?=\d)/, "");
  const year = new Date().getFullYear();
  const certNo = `EXL-${num}-${year}`;
  const today = new Date().toISOString().slice(0, 10);
  const validTo = new Date(); validTo.setMonth(validTo.getMonth() + 36);
  r.data = { ...data, certNo, validFrom: today, validTo: validTo.toISOString().slice(0, 10) };
  r.status = "Certified";
  await r.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "business.exelera.ex-cab.certificate_issued", entityType: "BusinessRecord", entityId: r.id, sourceIp: ip, result: "Success" });
  return view(r);
}
