import fs from "fs";
import path from "path";
import { z } from "zod";
import { BusinessRecord, ImplementationRecord } from "../models";
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
  refs: Record<string, string | null | undefined> = {},
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
): Promise<SeedRowResult> {
  const code = await nextCode(orgId, area, module, data);
  const r = await BusinessRecord.create({ orgId, area, module, code, title, status, owner, company, data });
  return { id: r.id, code: r.code };
}

function str(row: Record<string, unknown>, key: string, fallback = ""): string {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
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

  const coursesMap = new Map<string, string>();
  for (const row of loadDump("courses")) {
    const disciplineId = row.disciplineId ? disciplinesMap.get(String(row.disciplineId)) ?? String(row.disciplineId) : undefined;
    const data = pickData("ent-db-courses", row, { disciplineId });
    const status = row.active === false ? "Inactive" : "Active";
    const r = await seedRow(orgId, "enterprise", "ent-db-courses", str(row, "title"), status, null, companyFor("enterprise", row), data);
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
    await seedRow(orgId, "enterprise", "ent-payroll", str(row, "name"), str(row, "status", "Scheduled"), null, companyFor("enterprise", row), data);
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
    const data = pickData(module, row);
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
    const data = pickData("ent-proposals", row, { inqId, leadId });
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
    const r = await seedRow(orgId, "enterprise", "ent-pr", str(row, "title") || str(row, "description"), str(row, "status", "Draft"), str(row, "requester") || null, companyFor("enterprise", row), data);
    prMap.set(String(row.id), r.id);
    purchaseRequestRows.push({ odId: String(row.id), recordId: r.id });
    bump("ent-pr");
  }

  const poMap = new Map<string, string>();
  for (const row of loadDump("purchaseOrders")) {
    const prId = row.prId ? prMap.get(String(row.prId)) ?? String(row.prId) : undefined;
    const data = pickData("ent-po", row, { prId });
    const r = await seedRow(orgId, "enterprise", "ent-po", str(row, "supplierName"), str(row, "status", "Issued"), null, companyFor("enterprise", row), data);
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

  const rows = loadDump<Record<string, unknown>>("suppliers");
  let n = 0;
  for (const row of rows) {
    n += 1;
    const code = `SUP-${String(n).padStart(4, "0")}`;
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

  const rows = loadDump<Record<string, unknown>>("suppliers");
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
    await seedRow(orgId, "enterprise", "ent-suppliers", str(row, "name"), str(row, "status", "Approved"), null, companyFor("enterprise", row), data);
  }
  // eslint-disable-next-line no-console
  console.log(`  Enterprise suppliers seeded: ${n}`);
}
