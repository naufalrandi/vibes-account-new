import { BusinessProcess, BusinessProcessStep, ImplementationRecord, User } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { BadRequestError, NotFoundError } from "../../lib/errors";
import { writeAudit } from "../audit/audit.service";
import { createRisk, listRisks, type RiskRecordView } from "../risks/risk.service";

export const PROCESS_STATUSES = ["Active", "Inactive", "Archived"] as const;

/**
 * Master Business Process catalog (Database) — group -> process. Ported from
 * the OD prototype's `bpCatSeedIfNeeded` (`db.bpCatalog`). `wuEnsureBps()`
 * materialises this into each tenant's register on first sync.
 */
const CATALOG_GROUPS: { group: string; entries: [string, string][] }[] = [
  { group: "Software Development", entries: [
    ["Front End Development", "Client-side application development — UI implementation and browser delivery."],
    ["Back End Development", "Server-side logic, APIs and integrations."],
    ["Mobile Development", "Native and cross-platform mobile applications."],
    ["Solution Architecture", "System and solution design, standards and technical direction."],
    ["Requirements Management", "Elicit, document and manage functional and non-functional requirements."],
    ["Software Testing", "Test planning, execution and defect management (QA)."],
    ["Release Management", "Coordinate builds, versioning and production releases."],
    ["Configuration Management", "Control of configuration items, baselines and environments."],
    ["Change Management", "Assess, approve and implement changes in a controlled way."],
    ["DevOps & CI/CD", "Build/deploy pipelines, automation and environment provisioning."],
  ] },
  { group: "IT Operations & Security", entries: [
    ["Systems Administration", "Server, OS and platform operations and maintenance."],
    ["Network Administration", "Network provisioning, monitoring and connectivity."],
    ["Database Administration", "Database operation, tuning, integrity and availability."],
    ["Access Management", "Identity, authentication and authorization control."],
    ["Security Operations", "Monitoring, detection and security event handling."],
    ["Vulnerability Assessment", "Identify, evaluate and track technical vulnerabilities."],
    ["Incident Response", "Detect, contain and resolve security/IT incidents."],
    ["IT Service Desk", "First-line IT support and request fulfilment."],
    ["Backup & Recovery", "Data backup, restoration and continuity of IT services."],
  ] },
  { group: "Governance, Risk & Compliance", entries: [
    ["Management Review", "Top-management review of the management system."],
    ["Internal Audit", "Planned internal audits of processes and controls."],
    ["Risk Management", "Identification, assessment and treatment of risks."],
    ["Compliance Obligations", "Identify and manage legal, regulatory and other obligations."],
    ["Document & Records Control", "Control of documented information and records."],
    ["Policy Management", "Author, approve and maintain organizational policies."],
    ["Business Continuity", "Continuity planning and resilience of critical operations."],
  ] },
  { group: "Quality & Operations", entries: [
    ["Service / Production Delivery", "Core delivery of products or services to customers."],
    ["Quality Assurance", "Assurance activities that build quality into the process."],
    ["Quality Control & Inspection", "Inspection, testing and acceptance of outputs."],
    ["Nonconformity & Corrective Action", "Handle nonconformities and drive corrective action."],
    ["Continual Improvement", "Identify and implement improvement opportunities."],
    ["Calibration & Maintenance", "Maintenance and calibration of equipment and assets."],
    ["Supplier Quality", "Qualify and monitor supplier quality performance."],
  ] },
  { group: "Commercial & Sales", entries: [
    ["Lead & Opportunity Management", "Capture and qualify leads and sales opportunities."],
    ["Proposal & Quotation", "Prepare proposals, quotations and pricing."],
    ["Contract Management", "Negotiate, issue and administer contracts."],
    ["Customer Relationship Management", "Manage customer accounts and relationships."],
    ["Marketing & Communications", "Brand, demand generation and communications."],
    ["Order Management", "Order capture, fulfilment and tracking."],
  ] },
  { group: "Procurement & Supply Chain", entries: [
    ["Sourcing & Procurement", "Sourcing, purchasing and requisition-to-order."],
    ["Supplier & Vendor Management", "Onboard, evaluate and manage suppliers."],
    ["Inventory Management", "Stock control and replenishment."],
    ["Logistics & Distribution", "Warehousing, shipping and distribution."],
    ["Asset Management", "Lifecycle management of physical and IT assets."],
  ] },
  { group: "Human Resources", entries: [
    ["Recruitment & Onboarding", "Hiring and onboarding of personnel."],
    ["Training & Competence", "Competence development and training delivery."],
    ["Performance Management", "Objectives, appraisal and performance reviews."],
    ["Payroll Administration", "Payroll processing and disbursement."],
    ["Employee Relations & Disciplinary", "Grievances, discipline and employee relations."],
    ["Offboarding", "Separation, exit and access revocation."],
  ] },
  { group: "Finance & Accounting", entries: [
    ["General Ledger & Accounting", "Journals, ledgers and period close."],
    ["Accounts Payable", "Vendor invoices and payments."],
    ["Accounts Receivable & Billing", "Invoicing and collections."],
    ["Budgeting & Forecasting", "Budgets, forecasts and variance analysis."],
    ["Financial Reporting", "Statutory and management reporting."],
    ["Tax Management", "Tax computation, filing and compliance."],
  ] },
  { group: "Customer & Support", entries: [
    ["Customer Support", "Post-sale customer assistance."],
    ["Complaint & Feedback Management", "Capture and resolve complaints and feedback."],
    ["Warranty & Returns", "Warranty claims, returns and replacements."],
  ] },
];

const MASTER_CATALOG: { group: string; name: string; desc: string }[] = CATALOG_GROUPS.flatMap((g) =>
  g.entries.map(([name, desc]) => ({ group: g.group, name, desc }))
);

/** `bpCatNextId`-style key: stable per catalog name, used as the merge/dedupe key. */
function catalogKeyFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export interface BusinessProcessView {
  id: string;
  orgId: string;
  code: string;
  catalogKey: string | null;
  name: string;
  group: string | null;
  subgroup: string | null;
  description: string | null;
  status: string;
  sourceType: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BusinessProcessStepView {
  id: string;
  processId: string;
  seq: number;
  name: string;
  description: string | null;
  responsible: string | null;
  resources: string | null;
  kpi: string | null;
  roleId: string | null;
  workUnitId: string | null;
  next: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BusinessProcessInput {
  name?: string;
  description?: string | null;
  status?: string;
}

export interface BusinessProcessStepInput {
  name?: string;
  description?: string | null;
  responsible?: string | null;
  resources?: string | null;
  kpi?: string | null;
  roleId?: string | null;
  workUnitId?: string | null;
  next?: string[];
}

function view(p: BusinessProcess): BusinessProcessView {
  return {
    id: p.id, orgId: p.orgId, code: p.code, catalogKey: p.catalogKey, name: p.name, group: p.group, subgroup: p.subgroup,
    description: p.description, status: p.status, sourceType: p.sourceType, createdBy: p.createdBy,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

function stepView(s: BusinessProcessStep): BusinessProcessStepView {
  return {
    id: s.id, processId: s.processId, seq: s.seq, name: s.name, description: s.description,
    responsible: s.responsible, resources: s.resources, kpi: s.kpi, roleId: s.roleId, workUnitId: s.workUnitId,
    next: s.next ?? [], createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

function assertStatus(status: string) {
  if (!(PROCESS_STATUSES as readonly string[]).includes(status)) {
    throw new BadRequestError(`Invalid status "${status}"`, "INVALID_STATUS");
  }
}

/** Seeded/catalog rows are the master-catalog materialisation — OD blocks editing and archiving them. */
function assertEditable(p: BusinessProcess) {
  if (p.sourceType !== "Tenant Created") {
    throw new BadRequestError("Catalog-sourced processes cannot be edited or archived", "PROCESS_NOT_EDITABLE");
  }
}

async function nextCode(orgId: string): Promise<string> {
  const rows = await BusinessProcess.findAll({ where: { orgId }, attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const m = /^BP-(\d+)$/.exec(r.code);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `BP-${String(max + 1).padStart(4, "0")}`;
}

async function actorName(auth: AuthContext): Promise<string | null> {
  if (!auth.userId) return null;
  const u = await User.findByPk(auth.userId);
  return u?.fullName ?? u?.username ?? null;
}

async function requireProcess(auth: AuthContext, id: string): Promise<BusinessProcess> {
  const p = await BusinessProcess.findOne({ where: { id, orgId: auth.orgId } });
  if (!p) throw new NotFoundError("Business process does not exist", "PROCESS_NOT_FOUND");
  return p;
}

async function requireStep(auth: AuthContext, processId: string, stepId: string): Promise<BusinessProcessStep> {
  const s = await BusinessProcessStep.findOne({ where: { id: stepId, processId, orgId: auth.orgId } });
  if (!s) throw new NotFoundError("Process step does not exist", "STEP_NOT_FOUND");
  return s;
}

/**
 * Bridge for the older generic `ImplementationRecord` processes registry
 * (module "processes", still what the live FE registers process/step ids
 * against — see AXI-71). It has no row in `business_processes`/
 * `business_process_steps`, and its steps are just entries inside the
 * record's own `data.steps[]` JSON, not real rows. Resolve those ids here so
 * they still work, without adding a legacy id column or migrating the
 * registry.
 */
async function requireLegacyProcessStep(
  auth: AuthContext,
  processId: string,
  stepId: string
): Promise<{ processId: string; stepId: string }> {
  const record = await ImplementationRecord.findOne({
    where: { id: processId, orgId: auth.orgId, module: "processes" },
  });
  if (!record) throw new NotFoundError("Business process does not exist", "PROCESS_NOT_FOUND");
  const steps = Array.isArray((record.data as { steps?: unknown[] } | null)?.steps)
    ? ((record.data as { steps: { id?: unknown }[] }).steps)
    : [];
  const step = steps.find((s) => s?.id === stepId);
  if (!step) throw new NotFoundError("Process step does not exist", "STEP_NOT_FOUND");
  return { processId: record.id, stepId };
}

/** Resolves a process/step id pair against the new tables, falling back to the old registry bridge above. */
async function resolveProcessStep(
  auth: AuthContext,
  processId: string,
  stepId: string
): Promise<{ processId: string; stepId: string }> {
  try {
    const process = await requireProcess(auth, processId);
    const step = await requireStep(auth, processId, stepId);
    return { processId: process.id, stepId: step.id };
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err;
    return requireLegacyProcessStep(auth, processId, stepId);
  }
}

// ============================ Catalog merge ================================

/**
 * `wuEnsureBps()` port — idempotent merge of the master catalog into this
 * org's register. Matched per org by `catalogKey` (unique-indexed), so
 * running it twice adds nothing; an already-merged row is only backfilled
 * (group/description) when those fields are still empty, never recreated.
 */
export async function syncCatalog(auth: AuthContext, ip: string | null): Promise<BusinessProcessView[]> {
  const existing = await BusinessProcess.findAll({ where: { orgId: auth.orgId } });
  const byKey = new Map(existing.filter((p) => p.catalogKey).map((p) => [p.catalogKey as string, p]));

  let created = 0;
  for (const entry of MASTER_CATALOG) {
    const key = catalogKeyFor(entry.name);
    const ex = byKey.get(key);
    if (ex) {
      let changed = false;
      if (!ex.group) { ex.group = entry.group; changed = true; }
      if (!ex.description) { ex.description = entry.desc; changed = true; }
      if (changed) await ex.save();
      continue;
    }
    await BusinessProcess.create({
      orgId: auth.orgId,
      code: await nextCode(auth.orgId),
      catalogKey: key,
      name: entry.name,
      group: entry.group,
      subgroup: null,
      description: entry.desc,
      status: "Active",
      sourceType: "Catalog",
      createdBy: "System",
    });
    created++;
  }

  if (created > 0) {
    await writeAudit({
      actorUserId: auth.userId, organizationId: auth.orgId, action: "process.catalog_synced",
      entityType: "BusinessProcess", entityId: auth.orgId, sourceIp: ip, result: "Success",
    });
  }

  return listProcesses(auth);
}

// ================================ CRUD ======================================

export async function listProcesses(auth: AuthContext): Promise<BusinessProcessView[]> {
  const rows = await BusinessProcess.findAll({ where: { orgId: auth.orgId }, order: [["createdAt", "ASC"]] });
  return rows.map(view);
}

export async function getProcessById(auth: AuthContext, id: string): Promise<BusinessProcessView & { steps: BusinessProcessStepView[] }> {
  const p = await requireProcess(auth, id);
  const steps = await BusinessProcessStep.findAll({ where: { processId: id, orgId: auth.orgId }, order: [["seq", "ASC"]] });
  return { ...view(p), steps: steps.map(stepView) };
}

export async function createProcess(auth: AuthContext, input: BusinessProcessInput, ip: string | null): Promise<BusinessProcessView> {
  if (!input.name || !input.name.trim()) throw new BadRequestError("Name is required", "NAME_REQUIRED");
  const status = input.status?.trim() || "Active";
  assertStatus(status);

  const p = await BusinessProcess.create({
    orgId: auth.orgId,
    code: await nextCode(auth.orgId),
    catalogKey: null,
    name: input.name.trim(),
    group: null,
    subgroup: null,
    description: input.description ?? null,
    status,
    sourceType: "Tenant Created",
    createdBy: await actorName(auth),
  });

  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "process.created", entityType: "BusinessProcess", entityId: p.id, sourceIp: ip, result: "Success" });
  return view(p);
}

export async function updateProcess(auth: AuthContext, id: string, input: BusinessProcessInput, ip: string | null): Promise<BusinessProcessView> {
  const p = await requireProcess(auth, id);
  assertEditable(p);

  if (input.name !== undefined) {
    if (!input.name.trim()) throw new BadRequestError("Name is required", "NAME_REQUIRED");
    p.name = input.name.trim();
  }
  if (input.description !== undefined) p.description = input.description;
  if (input.status !== undefined) {
    assertStatus(input.status);
    p.status = input.status;
  }
  await p.save();

  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "process.updated", entityType: "BusinessProcess", entityId: p.id, sourceIp: ip, result: "Success" });
  return view(p);
}

export async function archiveProcess(auth: AuthContext, id: string, ip: string | null): Promise<BusinessProcessView> {
  const p = await requireProcess(auth, id);
  assertEditable(p);
  if (p.status === "Archived") throw new BadRequestError("Business process already archived", "PROCESS_ALREADY_ARCHIVED");

  p.status = "Archived";
  await p.save();

  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "process.archived", entityType: "BusinessProcess", entityId: p.id, sourceIp: ip, result: "Success" });
  return view(p);
}

// =============================== Steps ======================================

export async function listSteps(auth: AuthContext, processId: string): Promise<BusinessProcessStepView[]> {
  await requireProcess(auth, processId);
  const rows = await BusinessProcessStep.findAll({ where: { processId, orgId: auth.orgId }, order: [["seq", "ASC"]] });
  return rows.map(stepView);
}

export async function addStep(auth: AuthContext, processId: string, input: BusinessProcessStepInput, ip: string | null): Promise<BusinessProcessStepView> {
  await requireProcess(auth, processId);
  if (!input.name || !input.name.trim()) throw new BadRequestError("Step name is required", "NAME_REQUIRED");

  const rows = await BusinessProcessStep.findAll({ where: { processId }, attributes: ["seq"] });
  const maxSeq = rows.reduce((m, r) => Math.max(m, r.seq), 0);

  const s = await BusinessProcessStep.create({
    orgId: auth.orgId,
    processId,
    seq: maxSeq + 1,
    name: input.name.trim(),
    description: input.description ?? null,
    responsible: input.responsible ?? null,
    resources: input.resources ?? null,
    kpi: input.kpi ?? null,
    roleId: input.roleId ?? null,
    workUnitId: input.workUnitId ?? null,
    next: Array.isArray(input.next) ? input.next : [],
  });

  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "process.step_added", entityType: "BusinessProcessStep", entityId: s.id, sourceIp: ip, result: "Success" });
  return stepView(s);
}

export async function updateStep(auth: AuthContext, processId: string, stepId: string, input: BusinessProcessStepInput, ip: string | null): Promise<BusinessProcessStepView> {
  await requireProcess(auth, processId);
  const s = await requireStep(auth, processId, stepId);

  if (input.name !== undefined) {
    if (!input.name.trim()) throw new BadRequestError("Step name is required", "NAME_REQUIRED");
    s.name = input.name.trim();
  }
  if (input.description !== undefined) s.description = input.description;
  if (input.responsible !== undefined) s.responsible = input.responsible;
  if (input.resources !== undefined) s.resources = input.resources;
  if (input.kpi !== undefined) s.kpi = input.kpi;
  if (input.roleId !== undefined) s.roleId = input.roleId;
  if (input.workUnitId !== undefined) s.workUnitId = input.workUnitId;
  if (input.next !== undefined) s.next = Array.isArray(input.next) ? input.next : [];
  await s.save();

  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "process.step_updated", entityType: "BusinessProcessStep", entityId: s.id, sourceIp: ip, result: "Success" });
  return stepView(s);
}

export async function deleteStep(auth: AuthContext, processId: string, stepId: string, ip: string | null): Promise<{ id: string }> {
  await requireProcess(auth, processId);
  const s = await requireStep(auth, processId, stepId);
  await s.destroy();

  // Drop dangling edges pointing at the deleted step (OD `bpStepDel`).
  const siblings = await BusinessProcessStep.findAll({ where: { processId, orgId: auth.orgId } });
  for (const sib of siblings) {
    if ((sib.next || []).includes(stepId)) {
      sib.next = sib.next.filter((n) => n !== stepId);
      await sib.save();
    }
  }

  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "process.step_deleted", entityType: "BusinessProcessStep", entityId: stepId, sourceIp: ip, result: "Success" });
  return { id: stepId };
}

// ============================ Per-step risk raise ============================

/** `bpStepRiskMenu` port — raises a risk linked to this process step (`risk.processId`/`risk.stepId`). */
export async function raiseStepRisk(
  auth: AuthContext,
  processId: string,
  stepId: string,
  input: Record<string, unknown>,
  ip: string | null
): Promise<RiskRecordView> {
  const resolved = await resolveProcessStep(auth, processId, stepId);

  return createRisk(
    auth,
    {
      ...input,
      processId: resolved.processId,
      stepId: resolved.stepId,
      source: input.source || "Business Process",
      issueCategory: input.issueCategory || "Process Risk",
    },
    ip
  );
}

/** Linked risks for a step, for the step's risk badge/menu (OD `bpRisksForStep`). */
export async function stepRisks(auth: AuthContext, processId: string, stepId: string): Promise<RiskRecordView[]> {
  const resolved = await resolveProcessStep(auth, processId, stepId);
  const all = await listRisks(auth, {});
  return all.filter((r) => r.processId === resolved.processId && r.stepId === resolved.stepId);
}
