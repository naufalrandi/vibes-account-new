import { WorkUnit } from "../../db/models/workUnit.model";
import { Site, User } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { logActivity } from "../record-events/recordEvent.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

/** Record-events module key — shared with `recordEvent.routes.ts`'s `MODULE_ACTIONS`. */
const RECORD_MODULE = "work-units";

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

// OD mints work-unit ids as `WU-nnnn` (`wuNewId`, index.html:9070); the BE
// port originally used `WKU-`. New codes switch to `WU-` for parity — legacy
// `WKU-nnnn` rows are left untouched (never renamed; they resolve by the row's
// UUID `id`, not `code`, so nothing breaks) and still count toward the running
// max so numbering continues without resetting to 1.
async function nextCode(orgId: string): Promise<string> {
  const rows = await WorkUnit.findAll({ where: { orgId }, attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^(WKU|WU)-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `WU-${String(max + 1).padStart(4, "0")}`;
}

async function actorName(auth: AuthContext): Promise<string | null> {
  if (!auth.userId) return null;
  const u = await User.findByPk(auth.userId);
  return u?.fullName ?? u?.username ?? null;
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
  // OD `wuSave` (index.html:9320): `ocLogAdd(nw,'created this work unit', …)`
  // — the drawer's Activity Timeline is now backed by the shared record-events
  // module (`RECORD_MODULE`), wired in `recordEvent.routes.ts`.
  const created = w.processIds.length
    ? `Created this work unit — assigned ${w.processIds.length} business process${w.processIds.length === 1 ? "" : "es"}`
    : "Created this work unit";
  await logActivity(auth, auth.orgId, RECORD_MODULE, w.id, created);
  return view(w);
}

export async function updateWorkUnit(auth: AuthContext, id: string, input: WorkUnitInput, ip: string | null): Promise<WorkUnitView> {
  const w = await requireWorkUnit(auth, id);
  const beforeProcessIds = w.processIds ?? [];
  const changed: string[] = [];
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new BadRequestError("Name is required", "NAME_REQUIRED");
    if (w.name !== input.name.trim()) changed.push("name");
    w.name = input.name.trim();
  }
  if (input.status !== undefined) {
    assertStatus(input.status);
    if (w.status !== input.status) changed.push(`status → ${input.status}`);
    w.status = input.status;
  }
  if (input.siteId !== undefined) {
    await assertSite(auth.orgId, input.siteId);
    if (w.siteId !== input.siteId) changed.push("site");
    w.siteId = input.siteId;
  }
  if (input.description !== undefined) w.description = input.description;
  if (input.processIds !== undefined) w.processIds = arr(input.processIds);
  if (input.envIds !== undefined) w.envIds = arr(input.envIds);
  if (input.depIds !== undefined) w.depIds = arr(input.depIds);
  await w.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "workUnit.updated", entityType: "WorkUnit", entityId: w.id, sourceIp: ip, result: "Success" });

  // OD `wuSave` logs up to three entries on edit: the field-change summary,
  // then separate "assigned"/"removed" entries for the business-process diff
  // (index.html:9313-9315).
  await logActivity(auth, auth.orgId, RECORD_MODULE, w.id, changed.length ? `Work unit edited — updated ${changed.join(", ")}` : "Details updated");
  const afterProcessIds = w.processIds ?? [];
  const added = afterProcessIds.filter((x) => !beforeProcessIds.includes(x));
  const removed = beforeProcessIds.filter((x) => !afterProcessIds.includes(x));
  if (added.length) await logActivity(auth, auth.orgId, RECORD_MODULE, w.id, `Business process assigned — ${added.length} added`);
  if (removed.length) await logActivity(auth, auth.orgId, RECORD_MODULE, w.id, `Business process removed — ${removed.length} removed`);
  return view(w);
}

/** Soft-delete: OD archives work units rather than destroying them. */
export async function archiveWorkUnit(auth: AuthContext, id: string, ip: string | null): Promise<WorkUnitView> {
  const w = await requireWorkUnit(auth, id);
  w.status = "Archived";
  await w.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "workUnit.archived", entityType: "WorkUnit", entityId: w.id, sourceIp: ip, result: "Success" });
  // OD `wuArchive` (index.html:9360): "soft delete" — see the FE confirm copy.
  await logActivity(auth, auth.orgId, RECORD_MODULE, w.id, "Work unit archived — status set to Archived");
  return view(w);
}
