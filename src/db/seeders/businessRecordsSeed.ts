import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { BusinessRecord, Framework, ImplementationRecord, IpParty, IpRequirement, MReview, MsScope } from "../models";
import type { BusinessArea } from "../models/businessRecord.model";
import { getBusinessDataSchema } from "../../modules/business/dataSchemas";
import { nextCode } from "../../modules/business/business.service";
import { DN_BACKLOG, DN_CLIENTS, DN_ENGAGEMENTS, DN_FINDINGS, DN_PROJECTS } from "../../modules/business/datanaRules";

/**
 * SOF-38 — seeds the 39 OD collections that `business_records` (the generic Business Unit
 * register, `business.service.ts`) has carried a validation contract for since SOF-38's
 * `dataSchemas.ts`/`BIZ_CODE_CONFIG` landed, but never actually got any seeded rows.
 *
 * Source data: full JSON dumps of each OD collection under
 * `src/db/seeders/data/businessRecords/<collection>.json` (copied in from the parity
 * extraction so this seeder doesn't depend on a path outside this repo). Each file is
 * `{ count, fields, sample }` — `sample` here is the *complete* row set (`count === sample.
 * length` for every one of the 39 files), not a truncated preview.
 *
 * This deliberately does NOT go through `createBusiness` (business.service.ts): that
 * entrypoint takes a live `AuthContext` and runs per-request checks (duplicate-lead lookups,
 * activity-trail stamping, status-transition-graph gates) meant for one write at a time, not a
 * few-hundred-row bulk import. Instead this inserts `BusinessRecord` rows directly, but reuses
 * `nextCode` (exported from business.service.ts for exactly this purpose) so seeded codes match
 * what a live create would have produced, and validates every row's `data` blob against the
 * same per-module zod schema `createBusiness` would enforce (`getBusinessDataSchema` + `.parse`)
 * so a field-shape mistake here fails loudly at seed time instead of silently writing a payload
 * the API would 400 on.
 */

const DATA_DIR = path.resolve(__dirname, "data/businessRecords");

interface DumpFile<T> {
  count: number;
  fields: string[];
  sample: T[];
}

function loadDump<T = Record<string, unknown>>(name: string): T[] {
  const raw = fs.readFileSync(path.join(DATA_DIR, `${name}.json`), "utf8");
  const parsed = JSON.parse(raw) as DumpFile<T>;
  return parsed.sample;
}

/** Every field a target schema declares, so we only copy fields the module actually accepts —
 *  `.strict()` schemas 400/throw on anything else, so this is how each per-module "transform"
 *  below stays a plain field-copy instead of hand-listing every accepted key twice. */
function schemaKeys(module: string): Set<string> {
  const schema = getBusinessDataSchema(module);
  if (!schema) throw new Error(`No data schema registered for module ${module}`);
  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  return new Set(Object.keys(shape));
}

/** Copies every dump-row field the module's schema accepts, applying `refs` (field → remapped
 *  id) on top. Fields not in the schema (OD-only bookkeeping like `id`/`createdAt`, or a
 *  top-level column like `status`) are silently dropped — same as this backend's own
 *  `createBusiness` would end up doing via `.strict()`. */
function pickData(
  module: string,
  row: Record<string, unknown>,
  // A ref value may be an array: `termIds`/`defaultTerms` are lists of clause ids
  // that need the same OD-slug -> generated-id remap as the scalar references.
  refs: Record<string, string | string[] | null | undefined> = {},
): Record<string, unknown> {
  const keys = schemaKeys(module);
  const data: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in refs) {
      if (refs[key] !== undefined) data[key] = refs[key];
      continue;
    }
    if (row[key] !== undefined) data[key] = row[key];
  }
  const schema = getBusinessDataSchema(module)!;
  return schema.parse(data) as Record<string, unknown>;
}

/** `data.co` ("axia"/"exelera") is OD's own operating-company tag on a handful of enterprise
 *  collections (personLeads/proposals/projects/serviceContracts/sessions/...). Falls back to
 *  the module's own default company when the row doesn't carry one (Exelera-area modules
 *  default to "exelera"; everything else to "axia" — `business.service.ts`'s `defaultCompany`). */
function companyFor(area: BusinessArea, row: Record<string, unknown>): string {
  const co = typeof row.co === "string" ? row.co.toLowerCase().trim() : "";
  if (co === "axia" || co === "exelera") return co;
  return area === "exelera" ? "exelera" : "axia";
}

interface SeedRowResult {
  id: string;
  code: string;
}

/** Creates one `business_records` row and returns its new id/code, for building the
 *  OD-id → generated-id maps the cross-collection FK rewrites below depend on. */
async function seedRow(
  orgId: string,
  area: BusinessArea,
  module: string,
  title: string,
  status: string,
  owner: string | null,
  company: string,
  data: Record<string, unknown>,
  odCode?: string,
): Promise<SeedRowResult> {
  // `odCode` keeps the design's own record id where OD defines a real one that a
  // sequential mint cannot reproduce: `purchaseOrders` is PO-2044/2046/2048/2049/2051
  // (non-contiguous), `suppliers` carries two disjoint namespaces ("84-1".."84-14"
  // enterprise, "SUP-2001".."SUP-2007" tenant — `supNextId` modules.js:3618-3620), and
  // `purchaseRequests` is not stored in id order. Minting over these renumbered the
  // register while each row's own `data.activity` kept narrating the OD id
  // (modules.js:3097 `summary:'PR-3002'`), so the ID column and the activity rail
  // disagreed on screen. Callers without a design id keep the generated sequence.
  const code = odCode ?? (await nextCode(orgId, area, module, data));
  const r = await BusinessRecord.create({ orgId, area, module, code, title, status, owner, company, data });
  return { id: r.id, code: r.code };
}

function str(row: Record<string, unknown>, key: string, fallback = ""): string {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

/**
 * A parsed timestamp, or null — mirrors `israTenantDemo.ts`'s `date()` helper
 * verbatim (not exported there, so reproduced here rather than imported).
 * Guards against two shapes OD emits that Postgres rejects outright: the
 * empty string, and anything that parses to an Invalid Date.
 */
function date(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A `DATEONLY`-shaped value (`YYYY-MM-DD`), or null — mirrors
 * `israTenantDemo.ts`'s `dateOnly()` helper. OD writes both empty strings and
 * full ISO timestamps into fields this port's `type="date"` form inputs
 * expect as plain dates; both are narrowed here so a seeded row round-trips
 * cleanly through an `<input type="date">` instead of rendering "Invalid
 * Date" or a stray time-of-day.
 */
function dateOnly(v: unknown): string | null {
  const d = date(v);
  return d ? d.toISOString().slice(0, 10) : null;
}

export async function seedBusinessRecords(orgId: string): Promise<void> {
  // Idempotent: this is demo/parity data, not user data — if any rows already exist for this
  // org, assume a previous seed run already populated them (findOrCreate-per-row would need a
  // stable natural key this JSONB table doesn't have; skipping wholesale is simpler and correct
  // for a repeatable seed script).
  const already = await BusinessRecord.count({ where: { orgId } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Business records: ${already} already present, skipping.`);
    return;
  }

  const counts: Record<string, number> = {};
  const bump = (module: string) => { counts[module] = (counts[module] ?? 0) + 1; };

  // ---- Group A: independent collections (no FK into another seeded collection) ------------

  const banksMap = new Map<string, string>();
  for (const row of loadDump("banks")) {
    const data = pickData("ent-banks", row);
    const r = await seedRow(orgId, "enterprise", "ent-banks", str(row, "name"), "Active", null, companyFor("enterprise", row), data);
    banksMap.set(String(row.id), r.id);
    bump("ent-banks");
  }

  const clausesMap = new Map<string, string>();
  for (const row of loadDump("clauses")) {
    const data = pickData("ent-clauses", row);
    const r = await seedRow(orgId, "enterprise", "ent-clauses", str(row, "title"), "Active", null, companyFor("enterprise", row), data);
    clausesMap.set(String(row.id), r.id);
    bump("ent-clauses");
  }

  const disciplinesMap = new Map<string, string>();
  for (const row of loadDump("courseDisciplines")) {
    const data = pickData("ent-db-disciplines", row);
    const r = await seedRow(orgId, "enterprise", "ent-db-disciplines", str(row, "name"), "Active", null, companyFor("enterprise", row), data);
    disciplinesMap.set(String(row.id), r.id);
    bump("ent-db-disciplines");
  }

  // OD's course rows reference frameworks by its own opaque ids ("fw_dig57pn").
  // Framework rows here are created by `Framework.findOrCreate({ where: { name } })`
  // with UUID keys (complianceEngine.ts:130-138), so those slugs could never
  // resolve — `courseScopeLabel` (js/modules.js:1863) renders the standard name
  // from this reference, so the "Discipline / Standard" column was dangling.
  const OD_FRAMEWORK_NAMES: Record<string, string> = {
    fw_dig57pn: "ISO 9001:2015",
    fw_m47qbu4: "ISO 45001:2018",
    fw_a2qeo46: "ISO/IEC 27001:2022",
    fw_jl2ypan: "ISO/IEC 27701:2025",
  };
  const frameworkIdByName = new Map(
    (await Framework.findAll({ attributes: ["id", "name"] })).map((f) => [f.name, f.id]),
  );

  const coursesMap = new Map<string, string>();
  for (const row of loadDump("courses")) {
    const disciplineId = row.disciplineId ? disciplinesMap.get(String(row.disciplineId)) ?? String(row.disciplineId) : undefined;
    const odFw = row.frameworkId ? OD_FRAMEWORK_NAMES[String(row.frameworkId)] : undefined;
    const frameworkId = odFw ? frameworkIdByName.get(odFw) ?? undefined : undefined;
    const data = pickData("ent-db-courses", row, { disciplineId, frameworkId, standard: odFw });
    const status = row.active === false ? "Inactive" : "Active";
    const r = await seedRow(orgId, "enterprise", "ent-db-courses", str(row, "title"), status, null, companyFor("enterprise", row), data, str(row, "code") || undefined);
    coursesMap.set(String(row.id), r.id);
    bump("ent-db-courses");
  }

  const groupsMap = new Map<string, string>();
  for (const row of loadDump("groups")) {
    const data = pickData("ex-groups", row);
    const r = await seedRow(orgId, "exelera", "ex-groups", str(row, "name"), "Active", null, companyFor("exelera", row), data);
    groupsMap.set(String(row.id), r.id);
    bump("ex-groups");
  }

  for (const row of loadDump("holidays")) {
    const data = pickData("ent-holidays", row);
    await seedRow(orgId, "enterprise", "ent-holidays", str(row, "name"), row.type === "Religious" ? "Religious" : "Public", null, companyFor("enterprise", row), data);
    bump("ent-holidays");
  }

  for (const row of loadDump("minWages")) {
    const data = pickData("ent-minwage", row);
    const title = `${str(row, "region") || str(row, "scope")} minimum wage`.trim();
    await seedRow(orgId, "enterprise", "ent-minwage", title, "Active", null, companyFor("enterprise", row), data);
    bump("ent-minwage");
  }

  for (const row of loadDump("payComponents")) {
    const data = pickData("ent-comp", row);
    await seedRow(orgId, "enterprise", "ent-comp", str(row, "name"), "Active", null, companyFor("enterprise", row), data);
    bump("ent-comp");
  }

  for (const row of loadDump("payrollCycles")) {
    const data = pickData("ent-payroll", row);
    await seedRow(orgId, "enterprise", "ent-payroll", str(row, "name"), str(row, "status", "Scheduled"), null, companyFor("enterprise", row), data, str(row, "id") || undefined);
    bump("ent-payroll");
  }

  for (const row of loadDump("poTermsStd")) {
    const data = pickData("ent-po-terms", row);
    await seedRow(orgId, "enterprise", "ent-po-terms", str(row, "title"), "Active", null, companyFor("enterprise", row), data);
    bump("ent-po-terms");
  }

  for (const row of loadDump("spDeps")) {
    const data = pickData("ex-sp-deps", row);
    await seedRow(orgId, "exelera", "ex-sp-deps", str(row, "name"), str(row, "status", "Active"), null, companyFor("exelera", row), data);
    bump("ex-sp-deps");
  }
  for (const row of loadDump("spEnvs")) {
    const data = pickData("ex-sp-envs", row);
    await seedRow(orgId, "exelera", "ex-sp-envs", str(row, "name"), str(row, "status", "Active"), null, companyFor("exelera", row), data);
    bump("ex-sp-envs");
  }
  for (const row of loadDump("spPtypes")) {
    const data = pickData("ex-sp-ptypes", row);
    await seedRow(orgId, "exelera", "ex-sp-ptypes", str(row, "name"), str(row, "status", "Active"), null, companyFor("exelera", row), data);
    bump("ex-sp-ptypes");
  }

  for (const row of loadDump("ssSchemes")) {
    const data = pickData("ent-ss", row);
    await seedRow(orgId, "enterprise", "ent-ss", str(row, "name"), "Active", null, companyFor("enterprise", row), data);
    bump("ent-ss");
  }

  for (const row of loadDump("fiscalPeriods")) {
    const data = pickData("ent-fiscal", row);
    await seedRow(orgId, "enterprise", "ent-fiscal", str(row, "name"), str(row, "status", "Open"), null, companyFor("enterprise", row), data);
    bump("ent-fiscal");
  }

  for (const row of loadDump("leaveRequests")) {
    const data = pickData("ent-leave", row);
    await seedRow(orgId, "enterprise", "ent-leave", `${str(row, "requester")} — ${str(row, "type")}`, str(row, "status", "Pending Approval"), str(row, "requester") || null, companyFor("enterprise", row), data);
    bump("ent-leave");
  }

  for (const row of loadDump("mbTickets")) {
    const data = pickData("mb-support", row);
    await seedRow(orgId, "motoran", "mb-support", str(row, "subject"), str(row, "status", "Open"), null, companyFor("motoran", row), data);
    bump("mb-support");
  }

  const vehiclesMap = new Map<string, string>();
  for (const row of loadDump("mbVehicles")) {
    const data = pickData("mb-vehicle", row);
    const title = `${str(row, "make")} ${str(row, "model")} (${str(row, "plate")})`.trim();
    const r = await seedRow(orgId, "motoran", "mb-vehicle", title, str(row, "status", "Available"), null, companyFor("motoran", row), data);
    vehiclesMap.set(String(row.id), r.id);
    bump("mb-vehicle");
  }

  // `contractTypes` (SOF-38 dataSchemas.ts header ~L250): OD splits the same collection by
  // `data.domain` into three register keys sharing one schema.
  const contractTypesMap = new Map<string, string>();
  for (const row of loadDump("contractTypes")) {
    const domain = str(row, "domain", "Employment");
    const module = domain === "Service" ? "ent-svc-ctypes" : domain === "Supplier" ? "ent-sup-ctypes" : "ent-ctypes";
    const defaultTerms = Array.isArray(row.defaultTerms)
      ? (row.defaultTerms as unknown[]).map((t) => clausesMap.get(String(t)) ?? String(t))
      : undefined;
    const data = pickData(module, row, { defaultTerms });
    const r = await seedRow(orgId, "enterprise", module, str(row, "name"), str(row, "status", "Active"), null, companyFor("enterprise", row), data);
    contractTypesMap.set(String(row.id), r.id);
    bump(module);
  }

  const dnClientsMap = new Map<string, string>();
  for (const row of loadDump("dnClients")) {
    const data = pickData(DN_CLIENTS, row);
    const r = await seedRow(orgId, "datana", DN_CLIENTS, str(row, "name"), str(row, "status", "Active"), null, companyFor("datana", row), data);
    dnClientsMap.set(String(row.id), r.id);
    bump(DN_CLIENTS);
  }

  const leadsMap = new Map<string, string>();
  for (const row of loadDump("leads")) {
    const data = pickData("ent-leads", row);
    const r = await seedRow(orgId, "enterprise", "ent-leads", str(row, "company"), str(row, "status", "New"), str(row, "owner") || null, companyFor("enterprise", row), data);
    leadsMap.set(String(row.id), r.id);
    bump("ent-leads");
  }

  for (const row of loadDump("personLeads")) {
    const data = pickData("ent-leads-people", row);
    await seedRow(orgId, "enterprise", "ent-leads-people", str(row, "name"), str(row, "status", "New"), null, companyFor("enterprise", row), data);
    bump("ent-leads-people");
  }

  const jobOpeningsMap = new Map<string, string>();
  for (const row of loadDump("jobOpenings")) {
    const data = pickData("ent-recruitment", { ...row, entity: "opening" });
    const r = await seedRow(orgId, "enterprise", "ent-recruitment", str(row, "title"), str(row, "status", "Open"), null, companyFor("enterprise", row), data);
    jobOpeningsMap.set(String(row.id), r.id);
    bump("ent-recruitment (opening)");
  }

  // No other seeded collection references an `excClients` row by id, so its generated ids
  // don't need to be captured in a map.
  for (const row of loadDump("excClients")) {
    const data = pickData("ex-cab", row);
    await seedRow(orgId, "exelera", "ex-cab", str(row, "name"), str(row, "stage", "Application"), str(row, "leadAuditor") || null, companyFor("exelera", row), data);
    bump("ex-cab");
  }

  // ---- Group B: one hop of dependency on Group A -------------------------------------------

  const contractTypeProfilesMap = new Map<string, string>();
  for (const row of loadDump("contractTypeProfiles")) {
    const typeId = row.typeId ? contractTypesMap.get(String(row.typeId)) ?? String(row.typeId) : undefined;
    const data = pickData("ent-ctype-profiles", row, { typeId });
    const title = `${str(row, "localName")} (${str(row, "country")})`.trim();
    const r = await seedRow(orgId, "enterprise", "ent-ctype-profiles", title, "Active", null, companyFor("enterprise", row), data);
    contractTypeProfilesMap.set(String(row.id), r.id);
    bump("ent-ctype-profiles");
  }
  void contractTypeProfilesMap;

  for (const row of loadDump("contractTemplates")) {
    const typeId = row.typeId ? contractTypesMap.get(String(row.typeId)) ?? String(row.typeId) : undefined;
    const data = pickData("ent-ctype-templates", row, { typeId });
    await seedRow(orgId, "enterprise", "ent-ctype-templates", str(row, "name"), "Active", null, companyFor("enterprise", row), data);
    bump("ent-ctype-templates");
  }

  const candidatesMap = new Map<string, string>();
  for (const row of loadDump("candidates")) {
    const openingId = row.openingId ? jobOpeningsMap.get(String(row.openingId)) ?? String(row.openingId) : undefined;
    const data = pickData("ent-recruitment", { ...row, entity: "candidate" }, { openingId });
    const r = await seedRow(orgId, "enterprise", "ent-recruitment", str(row, "fullName"), str(row, "stage", "Applied"), null, companyFor("enterprise", row), data);
    candidatesMap.set(String(row.id), r.id);
    bump("ent-recruitment (candidate)");
  }
  void candidatesMap;

  const dnEngagementsMap = new Map<string, string>();
  for (const row of loadDump("dnEngagements")) {
    const clientId = row.clientId ? dnClientsMap.get(String(row.clientId)) ?? String(row.clientId) : undefined;
    const data = pickData(DN_ENGAGEMENTS, row, { clientId });
    const r = await seedRow(orgId, "datana", DN_ENGAGEMENTS, str(row, "name"), str(row, "status", "Scoping"), null, companyFor("datana", row), data);
    dnEngagementsMap.set(String(row.id), r.id);
    bump(DN_ENGAGEMENTS);
  }

  const dnProjectsMap = new Map<string, string>();
  for (const row of loadDump("dnProjects")) {
    const clientId = row.clientId ? dnClientsMap.get(String(row.clientId)) ?? String(row.clientId) : undefined;
    const data = pickData(DN_PROJECTS, row, { clientId });
    const r = await seedRow(orgId, "datana", DN_PROJECTS, str(row, "name"), str(row, "status", "Discovery"), null, companyFor("datana", row), data);
    dnProjectsMap.set(String(row.id), r.id);
    bump(DN_PROJECTS);
  }

  for (const row of loadDump("dnFindings")) {
    const engagementId = row.engagementId ? dnEngagementsMap.get(String(row.engagementId)) ?? String(row.engagementId) : undefined;
    const data = pickData(DN_FINDINGS, row, { engagementId });
    await seedRow(orgId, "datana", DN_FINDINGS, str(row, "title"), str(row, "status", "Open"), null, companyFor("datana", row), data);
    bump(DN_FINDINGS);
  }

  for (const row of loadDump("dnBacklog")) {
    const projectId = row.projectId ? dnProjectsMap.get(String(row.projectId)) ?? String(row.projectId) : undefined;
    const data = pickData(DN_BACKLOG, row, { projectId });
    await seedRow(orgId, "datana", DN_BACKLOG, str(row, "title"), str(row, "status", "Todo"), null, companyFor("datana", row), data);
    bump(DN_BACKLOG);
  }

  const inquiriesMap = new Map<string, string>();
  for (const row of loadDump("inquiries")) {
    const leadId = row.leadId ? leadsMap.get(String(row.leadId)) ?? String(row.leadId) : undefined;
    const data = pickData("ent-inq", row, { leadId });
    const r = await seedRow(orgId, "enterprise", "ent-inq", str(row, "leadName") || str(row, "serviceName"), str(row, "status", "Open"), null, companyFor("enterprise", row), data);
    inquiriesMap.set(String(row.id), r.id);
    bump("ent-inq");
  }

  for (const row of loadDump("mbBookings")) {
    const vehicleId = row.vehicleId ? vehiclesMap.get(String(row.vehicleId)) ?? String(row.vehicleId) : undefined;
    const data = pickData("mb-booking", row, { vehicleId });
    await seedRow(orgId, "motoran", "mb-booking", str(row, "customer"), str(row, "status", "Active"), null, companyFor("motoran", row), data);
    bump("mb-booking");
  }

  // ---- Group C: depends on Group B ----------------------------------------------------------

  const proposalsMap = new Map<string, string>();
  for (const row of loadDump("proposals")) {
    const inqId = row.inqId ? inquiriesMap.get(String(row.inqId)) ?? String(row.inqId) : undefined;
    const leadId = row.leadId ? leadsMap.get(String(row.leadId)) ?? String(row.leadId) : undefined;
    // OD's proposal detail resolves the service contract type by id
    // (`contractType(p.contractTypeId).name`, js/modules.js:2512). The dump carries
    // OD slugs ("ct-svc-audit"), so without this remap the reference dangles — the
    // same bug the `typeId` remaps a few loops up already avoid.
    const contractTypeId = row.contractTypeId
      ? contractTypesMap.get(String(row.contractTypeId)) ?? String(row.contractTypeId)
      : undefined;
    const termIds = Array.isArray(row.termIds)
      ? (row.termIds as unknown[]).map((t) => clausesMap.get(String(t)) ?? String(t))
      : undefined;
    const data = pickData("ent-proposals", row, { inqId, leadId, contractTypeId, termIds });
    const r = await seedRow(orgId, "enterprise", "ent-proposals", `${str(row, "leadName")} · ${str(row, "serviceName")}`, str(row, "status", "Draft"), null, companyFor("enterprise", row), data);
    proposalsMap.set(String(row.id), r.id);
    bump("ent-proposals");
  }

  // ---- Group D: depends on Group C ------------------------------------------------------------

  const serviceContractsMap = new Map<string, string>();
  for (const row of loadDump("serviceContracts")) {
    const inqId = row.inqId ? inquiriesMap.get(String(row.inqId)) ?? String(row.inqId) : undefined;
    const propId = row.propId ? proposalsMap.get(String(row.propId)) ?? String(row.propId) : undefined;
    const leadId = row.leadId ? leadsMap.get(String(row.leadId)) ?? String(row.leadId) : undefined;
    const data = pickData("ent-svc-contracts", row, { inqId, propId, leadId });
    const r = await seedRow(orgId, "enterprise", "ent-svc-contracts", `${str(row, "leadName")} · ${str(row, "serviceName")}`, str(row, "status", "Signed"), null, companyFor("enterprise", row), data);
    serviceContractsMap.set(String(row.id), r.id);
    bump("ent-svc-contracts");
  }

  // ---- Group E: depends on Group D ------------------------------------------------------------

  const projectsMap = new Map<string, string>();
  for (const row of loadDump("projects")) {
    const contractId = row.contractId ? serviceContractsMap.get(String(row.contractId)) ?? String(row.contractId) : undefined;
    const inqId = row.inqId ? inquiriesMap.get(String(row.inqId)) ?? String(row.inqId) : undefined;
    const leadId = row.leadId ? leadsMap.get(String(row.leadId)) ?? String(row.leadId) : undefined;
    const data = pickData("ent-projects", row, { contractId, inqId, leadId });
    const r = await seedRow(orgId, "enterprise", "ent-projects", str(row, "client") || str(row, "serviceName"), str(row, "status", "Planned"), null, companyFor("enterprise", row), data);
    projectsMap.set(String(row.id), r.id);
    bump("ent-projects");
  }

  // ---- Group F: training sessions, which depend on Group E --------------------------------
  // A private (in-house) session carries the project it was booked under — OD's
  // `mk(..., {projectId})` links SESS-7004 to the Exelera competence project PRJ-6210 and
  // logs "linked to PRJ-6210" on the session. That FK is why this runs after projects
  // rather than beside the other Group B collections.
  for (const row of loadDump("sessions")) {
    const courseId = row.courseId ? coursesMap.get(String(row.courseId)) ?? String(row.courseId) : undefined;
    const projectId = row.projectId ? projectsMap.get(String(row.projectId)) ?? String(row.projectId) : undefined;
    const data = pickData("ent-training-sessions", row, { courseId, projectId });
    await seedRow(orgId, "enterprise", "ent-training-sessions", str(row, "courseTitle"), str(row, "status", "Scheduled"), null, companyFor("enterprise", row), data);
    bump("ent-training-sessions");
  }

  // ---- Purchase Requests / Purchase Orders: mutually referential (PR.poId ↔ PO.prId) --------
  // OD stamps the PR with the PO minted from it (`poId`) once the PO is issued, so a handful of
  // PR rows in the dump already carry the other side's id before that PO row itself exists.
  // Seed PRs first (their own FK-less fields only), then POs resolving `prId` against the PR
  // map just built, then a short fixup pass rewrites the few PRs that had a `poId` in the dump
  // to point at the PO's real generated id.

  const purchaseRequestRows: { odId: string; recordId: string }[] = [];
  const prMap = new Map<string, string>();
  for (const row of loadDump("purchaseRequests")) {
    const data = pickData("ent-pr", row, { poId: undefined });
    const r = await seedRow(orgId, "enterprise", "ent-pr", str(row, "title") || str(row, "description"), str(row, "status", "Draft"), str(row, "requester") || null, companyFor("enterprise", row), data, str(row, "id") || undefined);
    prMap.set(String(row.id), r.id);
    purchaseRequestRows.push({ odId: String(row.id), recordId: r.id });
    bump("ent-pr");
  }

  const poMap = new Map<string, string>();
  for (const row of loadDump("purchaseOrders")) {
    const prId = row.prId ? prMap.get(String(row.prId)) ?? String(row.prId) : undefined;
    const data = pickData("ent-po", row, { prId });
    const r = await seedRow(orgId, "enterprise", "ent-po", str(row, "supplierName"), str(row, "status", "Issued"), null, companyFor("enterprise", row), data, str(row, "id") || undefined);
    poMap.set(String(row.id), r.id);
    bump("ent-po");
  }

  for (const row of loadDump("purchaseRequests")) {
    if (!row.poId) continue;
    const newPoId = poMap.get(String(row.poId));
    if (!newPoId) continue;
    const rec = purchaseRequestRows.find((p) => p.odId === String(row.id));
    if (!rec) continue;
    const record = await BusinessRecord.findByPk(rec.recordId);
    if (!record) continue;
    record.data = { ...(record.data as Record<string, unknown>), poId: newPoId };
    await record.save();
  }

  // eslint-disable-next-line no-console
  console.log("  Business records seeded per module:");
  for (const [module, n] of Object.entries(counts).sort()) {
    // eslint-disable-next-line no-console
    console.log(`    ${module}: ${n}`);
  }
}

/**
 * OD's `db.suppliers` (21 rows) backs the Tenant Quality register at
 * `/implementation/suppliers` (`SupplierWorkspace.tsx`, `listImplementation("suppliers")`),
 * not a `business_records` row — `suppliers` is an `ImplementationRecord` module
 * (`registry.ts`: `{ prefix: "SUP", statuses: [...] }`), so this reuses `data/businessRecords/
 * suppliers.json`'s dump (same `{count, fields, sample}` shape as every other collection in
 * this directory) but writes `ImplementationRecord` rows through `ImplementationRecord.create`
 * directly, mirroring `seed.ts`'s own hand-written `ImplementationRecord` blocks rather than
 * `seedRow`/`pickData` above (those are BusinessRecord-only: `nextCode`/`getBusinessDataSchema`
 * only resolve `business_records` modules).
 *
 * The dump's `sample` rows are already shaped to the fields `SupplierWorkspace.tsx` actually
 * reads off `data` (`categories`, `contact`, `entityName`, `taxNumber`, `type`, `website`,
 * `email`, `phone`, `bankName`, `bankAccount`, `bankCode`, `qualifiedDate`, `requalDate`,
 * `currency`, `pos`) — renamed from OD's own `category`/`contactName` at extraction time. OD's
 * `country`/`state`/`city`/`notes`/`terms`/`payAnchor`/`payAdvance`/`payRetention`/
 * `evaluations`/`activity` ride along in `data` for forward compatibility but have no reader in
 * this screen today (it derives its own scorecard from `pos`, not OD's supplier-level
 * `evaluations`/`activity`).
 */
export async function seedTenantSuppliers(orgId: string): Promise<void> {
  const already = await ImplementationRecord.count({ where: { orgId, module: "suppliers" } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Tenant suppliers: ${already} already present, skipping.`);
    return;
  }

  // OD keeps ONE `db.suppliers` array partitioned by id namespace, not two copies of all 21
  // rows: `supNextId` (modules.js:3618-3620) mints "SUP-2001" up when `SUP_CTX==='tn'` and
  // "84-1" up otherwise. Take only this side's namespace and keep the design's own id as the
  // code — seeding all 21 rows into both stores under a shared SUP-0001..SUP-0021 sequence
  // gave the two screens identical codes for different records.
  const rows = loadDump<Record<string, unknown>>("suppliers").filter((r) => /^SUP-\d+$/.test(String(r.id ?? "")));
  let n = 0;
  for (const row of rows) {
    n += 1;
    const code = str(row, "id");
    const data: Record<string, unknown> = {
      entityName: row.entityName, taxNumber: row.taxNumber, type: row.type, website: row.website,
      categories: row.categories, contact: row.contact, email: row.email, phone: row.phone,
      country: row.country, state: row.state, city: row.city,
      qualifiedDate: row.qualifiedDate, requalDate: row.requalDate,
      bankName: row.bankName, bankAccount: row.bankAccount, bankCode: row.bankCode,
      currency: row.currency, pos: row.pos,
      notes: row.notes, terms: row.terms, payAnchor: row.payAnchor,
      payAdvance: row.payAdvance, payRetention: row.payRetention,
      evaluations: row.evaluations, activity: row.activity,
    };
    await ImplementationRecord.create({
      orgId, module: "suppliers", code, title: str(row, "name"), status: str(row, "status", "Approved"),
      owner: null, data, elementId: null, frameworks: [],
    });
  }
  // eslint-disable-next-line no-console
  console.log(`  Tenant suppliers seeded: ${n}`);
}

/**
 * OD's `db.suppliers` (21 rows) also has no home on the Enterprise side — `EnterpriseSuppliersPage.tsx`
 * (`lib/procurement/suppliers.ts`'s `supplierData`) reads `ent-suppliers` `business_records` rows and
 * had exactly one, non-OD stub row before this. `ent-suppliers` has no `BUSINESS_DATA_SCHEMAS` entry
 * yet (tracked as known FE/BE drift, `moduleKeyDrift.test.ts`), so this can't route through
 * `pickData`/`schemaKeys` above (those require a registered zod schema) — it writes the `data` blob
 * by hand instead, same as `seedTenantSuppliers` does for the Tenant side.
 *
 * `SupplierData` (`lib/procurement/suppliers.ts`) is the closer match to OD's row shape than the
 * Tenant `ImplementationRecord` payload above: it has homes for `category` (OD's `categories`,
 * renamed to match the singular the frontend reader expects), `contactName` (OD's `contact`),
 * `country`/`state`/`city`, and the full `terms`/`payAnchor`/`payAdvance`/`payRetention` payment-terms
 * set — none of which the Tenant screen's schema carries a reader for. OD's `currency` and `pos`
 * fields (present in the tenant dump's payload) have no field on `SupplierData` and are dropped here;
 * see the seeder's caller for why that's a deliberate, reported gap rather than silent data loss.
 */
export async function seedEnterpriseSuppliers(orgId: string): Promise<void> {
  const already = await BusinessRecord.count({ where: { orgId, area: "enterprise", module: "ent-suppliers" } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Enterprise suppliers: ${already} already present, skipping.`);
    return;
  }

  // Enterprise half of OD's single `db.suppliers` array — the `SUP_ID_CODE` ("84-") namespace
  // of `supNextId` (modules.js:3618-3620). See `seedTenantSuppliers` for the same split.
  const rows = loadDump<Record<string, unknown>>("suppliers").filter((r) => /^84-\d+$/.test(String(r.id ?? "")));
  let n = 0;
  for (const row of rows) {
    n += 1;
    const data: Record<string, unknown> = {
      entityName: row.entityName, taxNumber: row.taxNumber, type: row.type, website: row.website,
      category: row.categories, contactName: row.contact, email: row.email, phone: row.phone,
      country: row.country, state: row.state, city: row.city,
      terms: row.terms, payAnchor: row.payAnchor, payAdvance: row.payAdvance, payRetention: row.payRetention,
      bankName: row.bankName, bankAccount: row.bankAccount, bankCode: row.bankCode,
      qualifiedDate: row.qualifiedDate, requalDate: row.requalDate, notes: row.notes,
      evaluations: row.evaluations, activity: row.activity,
    };
    await seedRow(orgId, "enterprise", "ent-suppliers", str(row, "name"), str(row, "status", "Approved"), null, companyFor("enterprise", row), data, str(row, "id") || undefined);
  }
  // eslint-disable-next-line no-console
  console.log(`  Enterprise suppliers seeded: ${n}`);
}

/**
 * SOF-322 audit gap, ISO 9001-extension registers: OD's `db.custSat`,
 * `db.designItems`, `db.psrCatalog`/`db.psrRecords`/`db.psrSpecTemplates`, and
 * `db.controlPlans` back four Tenant Quality-extension registers
 * (`/implementation/customer-satisfaction`, `/implementation/design`,
 * `/implementation/psr`, `/implementation/provision`) that had no seed at
 * all, so they rendered empty in every mode. Same convention as
 * `seedTenantSuppliers` above: `ImplementationRecord` rows written directly
 * (never through `createImplementation`, which is a live-request path, not a
 * bulk import), field shape checked against each register's own bespoke
 * workspace component (`CustomerSatisfactionWorkspace.tsx`/
 * `DesignWorkspace.tsx`/`PsrWorkspace.tsx`/`ControlPlanWorkspace.tsx` under
 * `app/(app)/implementation/**`) rather than the generic `lib/implementation/
 * config.ts` field list those bespoke screens don't actually render through.
 *
 * `activity`/`comments` ride in every one of OD's dumped rows below but have
 * NO home on any of these four screens — the port's activity/comment rail
 * (`RecordEventsPanel.tsx`) reads a separate `record_events` store keyed off
 * the record's own id via `listRecordEvents`, never `data.activity`/
 * `data.comments`. They are deliberately dropped here rather than carried
 * into `data` as inert bookkeeping, since (unlike e.g. suppliers' unused
 * `country`/`notes`) they'd collide in shape with nothing this app ever
 * reads and would only be noise.
 */

/** OD `db.custSat` → `customer-satisfaction` (prefix CSAT, registry.ts:164). */
export async function seedCustomerSatisfaction(orgId: string): Promise<void> {
  const already = await ImplementationRecord.count({ where: { orgId, module: "customer-satisfaction" } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Customer satisfaction: ${already} already present, skipping.`);
    return;
  }

  const rows = loadDump<Record<string, unknown>>("custSat");
  let n = 0;
  for (const row of rows) {
    n += 1;
    const code = `CSAT-${String(n).padStart(4, "0")}`;
    // `CustomerSatisfactionWorkspace.tsx`'s `CustSatFeedback` shape: source/
    // ftype/overall/cats/comment/postDate/routedTo/routedRecordId — no owner
    // field at all (`hasOwner: true` on the generic config entry is unused by
    // this bespoke screen).
    const data: Record<string, unknown> = {
      source: row.source,
      ftype: row.ftype,
      overall: row.overall,
      cats: row.cats,
      comment: row.comment,
      // OD `csForm`'s Received Date is a `type="date"` input (`fPostDate`) —
      // OD dumps full ISO timestamps here, narrowed to a plain date.
      postDate: dateOnly(row.postDate),
      routedTo: row.routedTo || undefined,
      routedRecordId: row.routedRecordId || undefined,
    };
    await ImplementationRecord.create({
      orgId, module: "customer-satisfaction", code, title: str(row, "customer"),
      status: str(row, "status", "New"), owner: null, data, elementId: null, frameworks: [],
    });
  }
  // eslint-disable-next-line no-console
  console.log(`  Customer satisfaction seeded: ${n}`);
}

/** OD `db.designItems` → `design` (prefix DND — OD's own `dndSave`/`ipPad(db.designItems,'DND-')`,
 *  registry.ts:194 — not the "DSG" the frontend mock's `IMPL_PREFIX` table invents). */
export async function seedDesignItems(orgId: string): Promise<void> {
  const already = await ImplementationRecord.count({ where: { orgId, module: "design" } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Design items: ${already} already present, skipping.`);
    return;
  }

  const rows = loadDump<Record<string, unknown>>("designItems");
  let n = 0;
  for (const row of rows) {
    n += 1;
    const code = `DND-${String(n).padStart(4, "0")}`;
    const owner = str(row, "owner") || null;
    // `DesignWorkspace.tsx`'s `DesignItem` shape. `data.code` is OD's own
    // user-entered "Code / Reference" field (e.g. "GX-200"), distinct from
    // this register's own generated `code` (DND-0001) above. `data.owner` is
    // set alongside the top-level `owner` column: the workspace's own save
    // handlers (`handleSaveItem`/`handleAdvanceStage`/`handleSetStatus`) only
    // ever send `data.owner`, never a top-level `owner` field, on write — so
    // seeding only the top-level column would make a freshly-created design
    // item's Owner column go blank the moment anyone edited it. Both are kept
    // in sync here to match what the live app itself would end up storing.
    const data: Record<string, unknown> = {
      code: row.code,
      version: row.version,
      kind: row.kind,
      category: row.category,
      owner,
      // OD `dndForm`'s Target Release Date is a `type="date"` input; every
      // row in this dump carries `targetDate: ""` — narrowed to null rather
      // than passed through as an empty string.
      targetDate: dateOnly(row.targetDate),
      summary: row.summary,
      attributes: row.attributes,
      options: row.options,
      inputs: row.inputs,
      outputs: row.outputs,
      reviewNotes: row.reviewNotes,
      verificationNotes: row.verificationNotes,
      validationNotes: row.validationNotes,
    };
    await ImplementationRecord.create({
      orgId, module: "design", code, title: str(row, "name"),
      status: str(row, "status", "Concept"), owner, data, elementId: null,
      frameworks: Array.isArray(row.frameworks) ? (row.frameworks as string[]) : [],
    });
  }
  // eslint-disable-next-line no-console
  console.log(`  Design items seeded: ${n}`);
}

/**
 * OD's PSR module (`db.psrCatalog`/`db.psrRecords`/`db.psrSpecTemplates`)
 * collapses into this backend's one generic "psr" module (prefix PSR,
 * registry.ts:174), discriminated by `data.kind` — see `PsrWorkspace.tsx`'s
 * `loadData`. Unlike the frontend mock (`mockClient.ts`'s `psrMockCode`,
 * three independent CAT-/SPEC-/PSR- sequences), the real backend's
 * `nextCode(prefix)` mints OD's three sequences — CAT- offerings, SPEC- templates,
 * PSR- §8.2.3 records —
 * this seeder mints its own codes the same way (one counter, all three
 * kinds), a known FE mock/BE drift this task does not touch.
 *
 * Seeded in dependency order: templates first (so catalog offerings can
 * resolve `templateId` to the generated row's backend UUID — the id
 * `PsrWorkspace.tsx` actually matches offerings against, not OD's own
 * "SPEC-0001" id), then catalog offerings (so records can resolve
 * `linkedOffering` to the generated offering's *display* code — a plain
 * string this screen only ever renders, never looks up, so it must be a
 * value that still means something in this backend, not OD's "CAT-0005").
 */
export async function seedPsr(orgId: string): Promise<void> {
  const already = await ImplementationRecord.count({ where: { orgId, module: "psr" } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  PSR: ${already} already present, skipping.`);
    return;
  }

  // OD keeps the three PSR kinds in separate arrays with separate prefixes and
  // separate sequences: `CAT-` offerings, `SPEC-` templates, `PSR-` §8.2.3
  // records (app.html:11507-11938). One flat `PSR-` run across all three would
  // renumber every row against the baseline and against the offline mock, which
  // splits them the same way OD does.
  const seq = { CAT: 0, SPEC: 0, PSR: 0 };
  const nextCode = (prefix: "CAT" | "SPEC" | "PSR") =>
    `${prefix}-${String((seq[prefix] += 1)).padStart(4, "0")}`;

  // -- Spec templates (data.kind: "template") --------------------------------
  const templates = loadDump<Record<string, unknown>>("psrSpecTemplates");
  const templateIdMap = new Map<string, string>(); // OD "SPEC-0001" -> generated backend id
  const templateNameMap = new Map<string, string>(); // OD "SPEC-0001" -> template name
  for (const row of templates) {
    const code = nextCode("SPEC");
    const data: Record<string, unknown> = {
      kind: "template",
      description: row.description,
      appliesTo: row.appliesTo,
      attributes: row.attributes,
    };
    const r = await ImplementationRecord.create({
      orgId, module: "psr", code, title: str(row, "name"),
      status: str(row, "status", "Active"), owner: null, data, elementId: null, frameworks: [],
    });
    templateIdMap.set(String(row.id), r.id);
    templateNameMap.set(String(row.id), str(row, "name"));
  }

  // -- Catalog offerings (data.kind: "offering") -----------------------------
  const catalog = loadDump<Record<string, unknown>>("psrCatalog");
  const offeringCodeMap = new Map<string, string>(); // OD "CAT-0001" -> generated register code
  for (const row of catalog) {
    const code = nextCode("CAT");
    const odTemplateId = row.templateId ? String(row.templateId) : undefined;
    const owner = str(row, "owner") || null;
    const data: Record<string, unknown> = {
      kind: "offering",
      code: row.code,
      type: row.type,
      category: row.category,
      templateId: odTemplateId ? templateIdMap.get(odTemplateId) : undefined,
      templateName: odTemplateId ? templateNameMap.get(odTemplateId) : undefined,
      revision: row.revision,
      // OD `psrForm`'s Review Date is a `type="date"` input; OD's own dump
      // is already `YYYY-MM-DD`, but normalized through the same helper as
      // every other date field rather than assumed safe.
      reviewDate: dateOnly(row.reviewDate),
      spec: row.spec,
      description: row.description,
      notes: row.notes,
    };
    const r = await ImplementationRecord.create({
      orgId, module: "psr", code, title: str(row, "name"),
      status: str(row, "status", "Active"), owner, data, elementId: null, frameworks: [],
    });
    offeringCodeMap.set(String(row.id), r.code);
  }

  // -- §8.2.3 requirements-review records (data.kind: "record") -------------
  const records = loadDump<Record<string, unknown>>("psrRecords");
  for (const row of records) {
    const code = nextCode("PSR");
    const odLinkedOffering = typeof row.linkedOffering === "string" ? row.linkedOffering : "";
    const owner = str(row, "owner") || null;
    const review = row.review && typeof row.review === "object" && !Array.isArray(row.review)
      ? { ...(row.review as Record<string, unknown>), date: dateOnly((row.review as Record<string, unknown>).date) }
      : null;
    const data: Record<string, unknown> = {
      kind: "record",
      docType: row.docType,
      provisionType: row.provisionType,
      customer: row.customer,
      value: row.value,
      currency: row.currency,
      linkedOffering: odLinkedOffering ? offeringCodeMap.get(odLinkedOffering) ?? "" : "",
      notes: row.notes,
      attachments: row.attachments,
      review,
    };
    await ImplementationRecord.create({
      orgId, module: "psr", code, title: str(row, "title"),
      status: str(row, "status", "Draft"), owner, data, elementId: null, frameworks: [],
    });
  }

  // eslint-disable-next-line no-console
  console.log(`  PSR seeded: ${templates.length} templates, ${catalog.length} catalog offerings, ${records.length} records`);
}

/** OD `db.controlPlans` → `provision` (prefix CP, registry.ts:197). */
export async function seedControlPlans(orgId: string): Promise<void> {
  const already = await ImplementationRecord.count({ where: { orgId, module: "provision" } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Control plans: ${already} already present, skipping.`);
    return;
  }

  const rows = loadDump<Record<string, unknown>>("controlPlans");
  let n = 0;
  for (const row of rows) {
    n += 1;
    const code = `CP-${String(n).padStart(4, "0")}`;
    const owner = str(row, "owner") || null;
    // `ControlPlanWorkspace.tsx`'s `ControlPlan` shape. `processName` has NO
    // home in OD's `controlPlans` dump — only `processId` (e.g. "BP-0027")
    // does — so it's left unset here; the workspace's own `loadPlans` falls
    // back to "Core Operational Process" when `data.processName` is absent,
    // same as a plan created before this field existed.
    const data: Record<string, unknown> = {
      processId: row.processId,
      productService: row.productService,
      revision: row.revision,
      approver: row.approver,
      // OD stamps `approvedDate` as a side effect of the Approve action
      // (never a typed form field) as a full ISO timestamp; narrowed to a
      // plain date like every other date field here.
      approvedDate: dateOnly(row.approvedDate),
      conditions: row.conditions,
      controlPoints: row.controlPoints,
    };
    await ImplementationRecord.create({
      orgId, module: "provision", code, title: str(row, "name"),
      status: str(row, "status", "Draft"), owner, data, elementId: null, frameworks: [],
    });
  }
  // eslint-disable-next-line no-console
  console.log(`  Control plans seeded: ${n}`);
}

/**
 * SOF-322 follow-up — Organization/edition-specific tenant registers that
 * still rendered empty: Interested Parties (its own `IpParty`/`IpRequirement`
 * models, ISO 4.2), Management Review (`MReview`, ISO 9.3), Management
 * System Scope (`MsScope`, the dedicated `/scope` document — NOT the orphan
 * `implementation_records` "scope" register removed at S12), and three
 * edition-specific `ImplementationRecord` registers (`cab-clients`,
 * `pcb-persons`, `lab-scope`). Also nests OD's `tnPOs` into the `suppliers`
 * register `seedTenantSuppliers` already seeds — see `seedTenantSupplierPOs`
 * below for why that one isn't its own module.
 *
 * `parties` (`lib/implementation/config.ts`) is itself an orphan duplicate
 * registration (`registry.ts` comment: "the real Interested Parties ...
 * register live[s] in ... src/modules/interested-parties ... never write[s]
 * through" the generic engine) — `InterestedPartiesPage.tsx` calls
 * `api.listIpParties()`/`api.listIpRequirements()`, never
 * `listImplementation("parties")`. So `ipParties`/`ipReqs` seed into
 * `IpParty`/`IpRequirement` directly, not an `ImplementationRecord` row.
 */

/** OD `ts`/`author` comment shape → this backend's `IpComment` (`id`/`user`/`ts`/`text`). */
function ipComments(v: unknown): { id: string; user: string; ts: string; text: string }[] {
  if (!Array.isArray(v)) return [];
  return (v as Record<string, unknown>[]).map((c) => ({
    id: randomUUID(), user: String(c.author ?? ""), ts: String(c.ts ?? ""), text: String(c.text ?? ""),
  }));
}

/**
 * `IpParty`/`IpRequirement` (`src/db/models/interestedParty.models.ts`).
 * OD's own "IP-0001"/"IP-REQ-0001" ids are reused verbatim as `code` (both
 * tables' `code` columns are independently unique, and no other seeder mints
 * these prefixes) rather than run through `nextCode()`.
 *
 * `postDate` rides on every OD row here (mirrors `createdAt`) but neither
 * model has a column for it — dropped, not carried into any field.
 */
export async function seedInterestedParties(orgId: string): Promise<void> {
  const already = await IpParty.count({ where: { orgId } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Interested parties: ${already} already present, skipping.`);
    return;
  }

  const partyRows = loadDump<Record<string, unknown>>("ipParties");
  const partyIdMap = new Map<string, string>(); // OD "IP-0001" -> generated backend id
  for (const row of partyRows) {
    const r = await IpParty.create({
      orgId, code: str(row, "id"), name: str(row, "name"), category: str(row, "category"),
      description: (row.description as string) ?? null, frameworks: Array.isArray(row.frameworks) ? (row.frameworks as string[]) : [],
      status: str(row, "status", "Active"), createdBy: (row.createdBy as string) ?? null, lastUpdatedBy: (row.lastUpdatedBy as string) ?? null,
      activity: Array.isArray(row.activity) ? (row.activity as never[]) : [], comments: ipComments(row.comments),
    });
    partyIdMap.set(String(row.id), r.id);
  }

  const reqRows = loadDump<Record<string, unknown>>("ipReqs");
  let skipped = 0;
  for (const row of reqRows) {
    const partyId = partyIdMap.get(String(row.partyId));
    if (!partyId) { skipped += 1; continue; } // FK guard, mirrors israTenantDemo.ts's own scenario-skip pattern
    await IpRequirement.create({
      orgId, code: str(row, "id"), partyId, topic: str(row, "topic"), description: (row.description as string) ?? null,
      type: str(row, "type", "Requirement"), frameworks: Array.isArray(row.frameworks) ? (row.frameworks as string[]) : [],
      relatedCO: row.relatedCO === true, linkedObligations: Array.isArray(row.linkedObligations) ? (row.linkedObligations as string[]) : [],
      status: str(row, "status", "Open"), raisedAsRisk: row.raisedAsRisk === true,
      createdBy: (row.createdBy as string) ?? null, lastUpdatedBy: (row.lastUpdatedBy as string) ?? null,
      activity: Array.isArray(row.activity) ? (row.activity as never[]) : [], comments: ipComments(row.comments),
    });
  }
  // eslint-disable-next-line no-console
  console.log(`  Interested parties seeded: ${partyRows.length} parties, ${reqRows.length - skipped} requirements${skipped ? ` (${skipped} skipped, missing party)` : ""}`);
}

/**
 * `MReview` (`src/db/models/evaluation.models.ts`) backs `/v1/management-review`
 * and the `reviews` implementation-config screen (`ManagementReviewPanel.tsx`).
 * OD's dump maps onto the model almost field-for-field — `topics[].action`/
 * `invited`/`external` already match `MrAction`/`MrInvitee`/`MrExternal`
 * exactly. `activity`/`comments` ride on the OD row (mirroring `IpParty`'s
 * shape) but `MReview` has no column for either — this screen's activity
 * rail is the generic audit log (`mReview.service.ts`'s `writeAudit`, read
 * back through `RecordEventsPanel` keyed by entity id), not a `data.activity`
 * field — so, like `postDate`/`tenantId`, they are dropped, not carried.
 */
export async function seedManagementReviews(orgId: string): Promise<void> {
  const already = await MReview.count({ where: { orgId } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Management reviews: ${already} already present, skipping.`);
    return;
  }

  const rows = loadDump<Record<string, unknown>>("mreviews");
  for (const row of rows) {
    await MReview.create({
      orgId, code: str(row, "id"), title: (row.title as string) ?? null,
      frameworks: Array.isArray(row.frameworks) ? (row.frameworks as string[]) : [],
      date: dateOnly(row.date) ?? "", time: str(row, "time"), tz: str(row, "tz", "Asia/Jakarta"),
      format: str(row, "format", "Virtual"), link: (row.link as string) || null, location: (row.location as string) || null,
      chairperson: (row.chairperson as string) || null, recorder: (row.recorder as string) || null,
      status: str(row, "status", "Draft"),
      invited: Array.isArray(row.invited) ? (row.invited as never[]) : [],
      external: Array.isArray(row.external) ? (row.external as never[]) : [],
      agenda: (row.agenda as string) || null, prep: (row.prep as string) || null, materials: (row.materials as string) || null,
      topics: Array.isArray(row.topics) ? (row.topics as never[]) : [],
      minutesSummary: (row.minutesSummary as string) || null,
      finalizedBy: (row.finalizedBy as string) || null, finalizedDate: (row.finalizedDate as string) || null,
      version: typeof row.version === "number" ? row.version : 1,
      createdBy: (row.createdBy as string) ?? null, lastUpdatedBy: (row.lastUpdatedBy as string) ?? null,
    });
  }
  // eslint-disable-next-line no-console
  console.log(`  Management reviews seeded: ${rows.length}`);
}

/** OD `ScopeDimRow`s ({name,status,note[,cat]}) as-is — matches `MsScope`'s own shape verbatim. */
function scopeDims(v: unknown): { name: string; status: string; note: string; cat?: string }[] {
  if (!Array.isArray(v)) return [];
  return (v as Record<string, unknown>[]).map((r) => ({
    name: String(r.name ?? ""), status: String(r.status ?? "Included"), note: String(r.note ?? ""),
    ...(r.cat ? { cat: String(r.cat) } : {}),
  }));
}
const scopeInScope = (r: { status: string }) => r.status === "Included" || r.status === "Partially Included";

/**
 * `MsScope` (`src/db/models/scope.models.ts`) backs the dedicated `/scope`
 * document page — NOT an `ImplementationRecord` module (the old duplicate
 * "scope" register was removed at S12). `effectiveDate`/`approvedDate` are
 * `DATEONLY` columns; OD dumps both as full ISO timestamps, so both go
 * through `dateOnly()`. `frameworkRelevance` isn't in OD's dump at all — it's
 * a column `scope.service.ts`'s `createScope` derives server-side from the
 * `frameworks` dimension (names of rows `Included`/`Partially Included`),
 * recomputed the same way here rather than left empty.
 *
 * `lastUpdatedBy` rides on the OD row but `MsScope` has no column for it
 * (only `createdBy`) — dropped. `postDate`/`tenantId` dropped as elsewhere.
 */
export async function seedMsScope(orgId: string): Promise<void> {
  const already = await MsScope.count({ where: { orgId } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Management system scope: ${already} already present, skipping.`);
    return;
  }

  const rows = loadDump<Record<string, unknown>>("msScopes");
  for (const row of rows) {
    const id = randomUUID();
    const frameworks = scopeDims(row.frameworks);
    await MsScope.create({
      id, lineageId: id, orgId, code: str(row, "id"), name: str(row, "name"),
      owner: (row.owner as string) || null, effectiveDate: dateOnly(row.effectiveDate),
      reviewFreq: str(row, "reviewFreq", "Annually"), status: str(row, "status", "Draft"),
      frameworks, sites: scopeDims(row.sites), processes: scopeDims(row.processes), envs: scopeDims(row.envs),
      personnel: scopeDims(row.personnel), deps: scopeDims(row.deps),
      statement: (row.statement as string) || null, limitations: (row.limitations as string) || null,
      approvalNotes: (row.approvalNotes as string) || null,
      frameworkRelevance: frameworks.filter(scopeInScope).map((f) => f.name),
      approvedBy: (row.approvedBy as string) || null, approvedDate: dateOnly(row.approvedDate),
      version: typeof row.version === "number" ? row.version : 1,
      baseline: null, pendingChange: null, supersededAt: null, supersededBy: null, supersededByVersion: null,
      createdBy: (row.createdBy as string) ?? null,
      activity: Array.isArray(row.activity) ? (row.activity as never[]) : [],
      comments: ipComments(row.comments),
    });
  }
  // eslint-disable-next-line no-console
  console.log(`  Management system scope seeded: ${rows.length}`);
}

/**
 * `cab-clients`/`pcb-persons`/`lab-scope` (`ImplementationRecord`, edition-
 * specific registers — `registry.ts`: CAB/PCB/Lab). Same convention as
 * `seedCustomerSatisfaction` et al. above: OD ids reused verbatim as `code`.
 *
 * `cab-clients`: OD's `nextSurveillance` has no column in `lib/implementation/
 * config.ts`'s columns/fields for this module (only `issued`/`expiry` are
 * read) — kept in `data` as inert bookkeeping like `suppliers`' unused
 * fields, not silently dropped, but has no reader today.
 */
export async function seedCabClients(orgId: string): Promise<void> {
  const already = await ImplementationRecord.count({ where: { orgId, module: "cab-clients" } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  CAB clients: ${already} already present, skipping.`);
    return;
  }

  const rows = loadDump<Record<string, unknown>>("cabClients");
  for (const row of rows) {
    const data: Record<string, unknown> = {
      standard: row.standard, certNo: row.certNo, scope: row.scope,
      issued: row.issued, expiry: row.expiry,
      // No reader on this screen today — see header note.
      nextSurveillance: row.nextSurveillance,
    };
    await ImplementationRecord.create({
      orgId, module: "cab-clients", code: str(row, "id"), title: str(row, "org"),
      status: str(row, "status", "Applicant"), owner: null, data, elementId: null, frameworks: [],
    });
  }
  // eslint-disable-next-line no-console
  console.log(`  CAB clients seeded: ${rows.length}`);
}

/**
 * `pcb-persons`: OD's `certified`/`expiry` have no column in `config.ts`'s
 * columns/fields for this module (only `scheme`/`certNo` are read) — kept in
 * `data` as inert bookkeeping, not silently dropped, but unread today.
 */
export async function seedPcbPersons(orgId: string): Promise<void> {
  const already = await ImplementationRecord.count({ where: { orgId, module: "pcb-persons" } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  PCB persons: ${already} already present, skipping.`);
    return;
  }

  const rows = loadDump<Record<string, unknown>>("pcbPersons");
  for (const row of rows) {
    const data: Record<string, unknown> = {
      scheme: row.scheme, certNo: row.certNo,
      // No reader on this screen today — see header note.
      certified: row.certified, expiry: row.expiry,
    };
    await ImplementationRecord.create({
      orgId, module: "pcb-persons", code: str(row, "id"), title: str(row, "name"),
      status: str(row, "status", "Certified"), owner: null, data, elementId: null, frameworks: [],
    });
  }
  // eslint-disable-next-line no-console
  console.log(`  PCB persons seeded: ${rows.length}`);
}

/**
 * `lab-scope`: title is OD's `item` (config.ts column label "Test
 * Parameter") — the only OD field that maps to the register's title rather
 * than a `data.*` column. `method`/`range` have no column in `config.ts`'s
 * columns/fields for this module (only `field`/`discipline`/`standard`/`cmc`
 * are read — `cmc`'s label is "CMC / Range" but there is no second flat
 * field for `range` itself) — kept in `data`, unread today.
 */
export async function seedLabScope(orgId: string): Promise<void> {
  const already = await ImplementationRecord.count({ where: { orgId, module: "lab-scope" } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Lab scope: ${already} already present, skipping.`);
    return;
  }

  const rows = loadDump<Record<string, unknown>>("labScopes");
  for (const row of rows) {
    const data: Record<string, unknown> = {
      discipline: row.discipline, field: row.field, standard: row.standard, cmc: row.cmc,
      // No reader on this screen today — see header note.
      method: row.method, range: row.range,
    };
    await ImplementationRecord.create({
      orgId, module: "lab-scope", code: str(row, "id"), title: str(row, "item"),
      status: str(row, "status", "Accredited"), owner: null, data, elementId: null, frameworks: [],
    });
  }
  // eslint-disable-next-line no-console
  console.log(`  Lab scope seeded: ${rows.length}`);
}

/**
 * OD's `tnPOs` (ISO §8.4.2/§8.4.3 supplier purchase orders) have NO home as
 * their own module: `lib/implementation/config.ts`'s "supplier-po" register
 * entry is itself dead code by its own header comment — "opened from a
 * supplier's own detail view ... never from a top-level nav route ... not
 * this generic engine" — no screen ever calls `listImplementation
 * ("supplier-po")` (`grep` across `app/`/`lib/` turns up only the type union,
 * the mock-client prefix table, and this same config entry, no reader). The
 * real, live-rendered home is `SupplierWorkspace.tsx`'s `TenantPO[]`, nested
 * at `data.pos` on the matching `suppliers` `ImplementationRecord` row
 * (`tnSupplierPayload`) — so this seeds INTO the rows `seedTenantSuppliers`
 * already created, matched by `supplierName` (unique across the 21-row
 * `suppliers` dump), not a new module.
 *
 * Must run after `seedTenantSuppliers`. OD's `id`/`supplierId` are kept
 * verbatim except `supplierId`, which is remapped from OD's own supplier id
 * ("SUP-2001") to the matching row's real backend id — `SupplierWorkspace.tsx`
 * sets `supplierId: activeSupplier.id` (the backend id) on every PO it
 * issues, so a PO carrying OD's placeholder id would point at nothing.
 *
 * `tenantId` and `activity` ride on every OD row here but `TenantPO` (the
 * type this screen actually renders through) has no field for either —
 * dropped, not carried into the nested object.
 */
export async function seedTenantSupplierPOs(orgId: string): Promise<void> {
  const supplierRows = await ImplementationRecord.findAll({ where: { orgId, module: "suppliers" } });
  const alreadyHasPos = supplierRows.some((r) => Array.isArray((r.data as Record<string, unknown>).pos) && ((r.data as Record<string, unknown>).pos as unknown[]).length > 0);
  if (alreadyHasPos) {
    // eslint-disable-next-line no-console
    console.log("  Tenant supplier POs: already present, skipping.");
    return;
  }

  const byName = new Map(supplierRows.map((r) => [r.title, r]));
  const poRows = loadDump<Record<string, unknown>>("tnPOs");
  const bySupplier = new Map<string, Record<string, unknown>[]>();
  for (const po of poRows) {
    const name = str(po, "supplierName");
    if (!bySupplier.has(name)) bySupplier.set(name, []);
    bySupplier.get(name)!.push(po);
  }

  let attached = 0;
  let unmatched = 0;
  for (const [name, pos] of bySupplier) {
    const supplierRow = byName.get(name);
    if (!supplierRow) { unmatched += pos.length; continue; }
    const newPos = pos.map((po) => ({
      id: po.id, supplierId: supplierRow.id, supplierName: po.supplierName, date: po.date,
      provisionType: po.provisionType, items: po.items, requiredDate: po.requiredDate,
      value: po.value, currency: po.currency, status: po.status,
      ...(po.receipt ? { receipt: po.receipt } : {}),
      ...(po.evaluation ? { evaluation: po.evaluation } : {}),
    }));
    const existingData = supplierRow.data as Record<string, unknown>;
    await supplierRow.update({ data: { ...existingData, pos: newPos } });
    attached += newPos.length;
  }
  // eslint-disable-next-line no-console
  console.log(`  Tenant supplier POs seeded: ${attached}${unmatched ? ` (${unmatched} unmatched supplier name)` : ""}`);
}
