import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import { DemoTenant } from "../../db/models";
import type { DemoApproval, DemoAccessStatus, DemoSeedStatus } from "../../db/models/demoTenant.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

/** Expired demo workspaces are archived after this window. */
export const DEMO_RETENTION_DAYS = 7;
const HOUR_MS = 3600 * 1000;

export interface DemoTenantView {
  id: string;
  code: string;
  org: string;
  name: string;
  email: string;
  title: string | null;
  country: string | null;
  module: string;
  modules: string[];
  intendedUse: string | null;
  tenantId: string;
  userId: string;
  username: string;
  tempPassword: string;
  role: string;
  approval: DemoApproval;
  accessStatus: DemoAccessStatus | null;
  seedStatus: DemoSeedStatus;
  validityHours: number;
  expiresAt: Date | null;
  lastLogin: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDemoInput {
  org: string;
  name: string;
  email: string;
  title?: string | null;
  country?: string | null;
  module: string;
  modules?: string[];
  intendedUse?: string | null;
  role?: string;
  validityHours?: number;
}

/** Demo Access is a Service-Provider platform control. */
function assertSp(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError();
}

function toView(d: DemoTenant): DemoTenantView {
  return {
    id: d.id, code: d.code, org: d.org, name: d.name, email: d.email, title: d.title,
    country: d.country, module: d.module, modules: d.modules, intendedUse: d.intendedUse,
    tenantId: d.tenantId, userId: d.userId, username: d.username, tempPassword: d.tempPassword,
    role: d.role, approval: d.approval, accessStatus: d.accessStatus, seedStatus: d.seedStatus,
    validityHours: d.validityHours, expiresAt: d.expiresAt, lastLogin: d.lastLogin,
    deletedAt: d.deletedAt, createdAt: d.createdAt, updatedAt: d.updatedAt,
  };
}

async function nextCode(): Promise<string> {
  const rows = await DemoTenant.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^DMO-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `DMO-${max + 1}`;
}

function slugUsername(email: string, org: string): string {
  const local = (email.split("@")[0] || org || "demo").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  return `${local || "demo"}.demo`;
}

/**
 * Advance time-based lifecycle: an Active workspace past its expiry becomes
 * Expired; an Expired one past the retention window is Archived. Runs on read.
 */
async function syncAndExpire(): Promise<void> {
  const rows = await DemoTenant.findAll({ where: { accessStatus: { [Op.in]: ["Active", "Expired"] } } });
  const now = Date.now();
  const ret = DEMO_RETENTION_DAYS * 24 * HOUR_MS;
  for (const d of rows) {
    const exp = d.expiresAt ? d.expiresAt.getTime() : 0;
    if (d.accessStatus === "Active" && exp && now > exp) {
      d.accessStatus = "Expired";
      await d.save();
    } else if (d.accessStatus === "Expired" && exp && now > exp + ret) {
      d.accessStatus = "Archived";
      await d.save();
    }
  }
}

export interface DemoFilters {
  approval?: DemoApproval;
  accessStatus?: DemoAccessStatus;
  search?: string;
}

export async function listDemoTenants(auth: AuthContext, filters: DemoFilters = {}): Promise<DemoTenantView[]> {
  assertSp(auth);
  await syncAndExpire();
  const rows = await DemoTenant.findAll({ order: [["createdAt", "DESC"]] });
  let views = rows.map(toView);
  if (filters.approval) views = views.filter((v) => v.approval === filters.approval);
  if (filters.accessStatus) views = views.filter((v) => v.accessStatus === filters.accessStatus);
  if (filters.search) {
    const s = filters.search.toLowerCase();
    views = views.filter((v) =>
      v.org.toLowerCase().includes(s) || v.email.toLowerCase().includes(s) ||
      v.module.toLowerCase().includes(s) || v.tenantId.toLowerCase().includes(s));
  }
  return views;
}

async function resolve(auth: AuthContext, id: string): Promise<DemoTenant> {
  assertSp(auth);
  const d = await DemoTenant.findByPk(id);
  if (!d) throw new NotFoundError("Demo workspace does not exist", "DEMO_NOT_FOUND");
  return d;
}

export async function getDemoTenant(auth: AuthContext, id: string): Promise<DemoTenantView> {
  return toView(await resolve(auth, id));
}

export async function createDemoTenant(auth: AuthContext, input: CreateDemoInput, ip: string | null): Promise<DemoTenantView> {
  assertSp(auth);
  if (!input.org.trim()) throw new BadRequestError("Organization is required", "ORG_REQUIRED");
  if (!input.email.trim()) throw new BadRequestError("Email is required", "EMAIL_REQUIRED");
  const code = await nextCode();
  const suffix = code.replace(/^DMO-/, "");
  const modules = input.modules && input.modules.length ? input.modules
    : input.module.split(",").map((s) => s.trim()).filter(Boolean);
  const d = await DemoTenant.create({
    code,
    org: input.org.trim(), name: input.name.trim(), email: input.email.trim(),
    title: input.title ?? null, country: input.country ?? null,
    module: input.module, modules, intendedUse: input.intendedUse ?? null,
    tenantId: `DEMO-${suffix}`, userId: `DU-${suffix}`,
    username: slugUsername(input.email, input.org), tempPassword: randomUUID().slice(0, 12),
    role: input.role ?? "Demo Tenant Admin",
    approval: "Pending", accessStatus: null, seedStatus: "Pending",
    validityHours: input.validityHours ?? 48, expiresAt: null, lastLogin: null, deletedAt: null,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.created", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}

export async function approveDemoTenant(auth: AuthContext, id: string, ip: string | null): Promise<DemoTenantView> {
  const d = await resolve(auth, id);
  d.approval = "Approved";
  await d.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.approved", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}

export async function rejectDemoTenant(auth: AuthContext, id: string, ip: string | null): Promise<DemoTenantView> {
  const d = await resolve(auth, id);
  d.approval = "Rejected";
  d.accessStatus = "Disabled";
  await d.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.rejected", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}

/** Approve + seed the isolated workspace, issue credentials, and start the clock. */
export async function generateDemoTenant(auth: AuthContext, id: string, ip: string | null): Promise<DemoTenantView> {
  const d = await resolve(auth, id);
  if (d.accessStatus === "Deleted") throw new BadRequestError("Cannot generate a deleted demo workspace", "DEMO_DELETED");
  d.approval = "Approved";
  d.seedStatus = "Seeded";
  d.accessStatus = "Active";
  d.expiresAt = new Date(Date.now() + (d.validityHours || 48) * HOUR_MS);
  await d.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.generated", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}

export async function resendDemoTenant(auth: AuthContext, id: string, ip: string | null): Promise<DemoTenantView> {
  const d = await resolve(auth, id);
  if (d.accessStatus !== "Active") throw new BadRequestError("Credentials can only be resent for active workspaces", "DEMO_NOT_ACTIVE");
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.resent", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}

export async function extendDemoTenant(auth: AuthContext, id: string, validityHours: number, ip: string | null): Promise<DemoTenantView> {
  const d = await resolve(auth, id);
  if (d.accessStatus === "Deleted") throw new BadRequestError("Cannot extend a deleted demo workspace", "DEMO_DELETED");
  if (!Number.isFinite(validityHours) || validityHours <= 0) throw new BadRequestError("Validity must be a positive number of hours", "INVALID_VALIDITY");
  d.validityHours = validityHours;
  d.expiresAt = new Date(Date.now() + validityHours * HOUR_MS);
  if (d.accessStatus === "Expired" || d.accessStatus === "Archived" || d.accessStatus === "Disabled") d.accessStatus = "Active";
  await d.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.extended", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}

export async function disableDemoTenant(auth: AuthContext, id: string, ip: string | null): Promise<DemoTenantView> {
  const d = await resolve(auth, id);
  d.accessStatus = "Disabled";
  await d.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.disabled", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}

export async function deleteDemoTenant(auth: AuthContext, id: string, ip: string | null): Promise<DemoTenantView> {
  const d = await resolve(auth, id);
  d.accessStatus = "Deleted";
  d.deletedAt = new Date();
  await d.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.deleted", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}
