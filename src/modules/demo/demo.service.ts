import { randomUUID } from "node:crypto";
import { Op, type Transaction } from "sequelize";
import { sequelize } from "../../db/sequelize";
import { DemoTenant, Organization, User, Role, Site, Menu, Action, RoleMenuGrant, RoleActionGrant, RefreshToken, TestingService } from "../../db/models";
import type { DemoApproval, DemoAccessStatus, DemoSeedStatus } from "../../db/models/demoTenant.model";
import type { AuthContext } from "../../lib/scope";
import { hashPassword } from "../../lib/password";
import { assignSubscription } from "../subscriptions/subscription.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

/** Expired demo workspaces are archived after this window. */
export const DEMO_RETENTION_DAYS = 7;
const HOUR_MS = 3600 * 1000;

// belongsToMany generates a `setRoles` mixin at runtime; the User model does not
// declare it, so reach it through a narrow association-only cast (same pattern
// as src/db/seeders/seed.ts).
type WithSetRoles = { setRoles: (roles: Role[], options?: { transaction?: Transaction }) => Promise<unknown> };

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

/** OD `demoActive()` — whether a demo workspace may currently be signed into: approved, not disabled/deleted/archived, and not past its expiry. Used by auth.service.ts's login() to gate a provisioned demo user. */
export function isDemoTenantActive(d: DemoTenant): boolean {
  if (d.approval === "Rejected") return false;
  if (d.accessStatus === "Disabled" || d.accessStatus === "Deleted" || d.accessStatus === "Archived") return false;
  const exp = d.expiresAt ? d.expiresAt.getTime() : 0;
  return exp > Date.now();
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
      await syncProvisionedUserStatus(d, "Suspended");
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
  await syncProvisionedUserStatus(d, "Suspended");
  await d.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.rejected", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}

type LimsStage = "Mandatory" | "Optional" | "Not Applicable";
const limsStages = (planning: LimsStage, sampling: LimsStage, cert: LimsStage, retention: LimsStage, disposal: LimsStage) =>
  ({ planning, sampling, cert, retention, disposal });

/**
 * A demo workspace that selected a laboratory module lands in the real LIMS
 * screens, so it needs data to look at — OD's Demo Lab is a pre-populated
 * scaffold, and an empty table would defeat the point of the demo.
 */
async function seedDemoLims(orgId: string, modules: string[], tx: Transaction): Promise<void> {
  const wantsLab = modules.some((m) => /testing|calibration|bundle|laboratory/i.test(m));
  if (!wantsLab) return;

  const seeds: { code: string; name: string; stages: Record<string, LimsStage> }[] = [
    { code: "TS-1001", name: "Environmental Testing", stages: limsStages("Mandatory", "Mandatory", "Not Applicable", "Mandatory", "Mandatory") },
    { code: "TS-1002", name: "Material Testing", stages: limsStages("Optional", "Optional", "Optional", "Mandatory", "Mandatory") },
    { code: "TS-1006", name: "Chemical Testing", stages: limsStages("Optional", "Optional", "Not Applicable", "Mandatory", "Mandatory") },
  ];
  for (const svc of seeds) {
    await TestingService.create(
      { orgId, code: svc.code, name: svc.name, description: `${svc.name} service line.`, status: "Active", stages: svc.stages },
      { transaction: tx },
    );
  }
}

/** Grant a role every menu + every action (mirrors seed.ts's grantEverything — a demo admin gets full access to whatever the collapsed demo nav lets them reach). */
async function grantEverything(roleId: string, tx: Transaction): Promise<void> {
  for (const menu of await Menu.findAll({ transaction: tx })) {
    await RoleMenuGrant.findOrCreate({ where: { roleId, menuId: menu.id }, defaults: { roleId, menuId: menu.id, granted: true }, transaction: tx });
  }
  for (const action of await Action.findAll({ transaction: tx })) {
    await RoleActionGrant.findOrCreate({ where: { roleId, actionId: action.id }, defaults: { roleId, actionId: action.id, granted: true }, transaction: tx });
  }
}

/**
 * Provisions the real Organization + Site + User + Role behind a demo
 * workspace (N8 closure) — the same shape as `tenant.service.ts`'s
 * `provisionTenant`, except the admin user comes out `Active` with a real
 * password hash immediately (no email-activation step; the SP hands the demo
 * user a working temp password right away, matching the OD prototype's
 * always-on demo accounts). `d.tenantId`/`d.username`/`d.tempPassword` are
 * already unique (issued by `createDemoTenant`) so they're reused verbatim as
 * the org code / login identity / password source of truth.
 */
async function provisionRealDemoIdentity(d: DemoTenant): Promise<{ orgId: string; userId: string }> {
  return sequelize.transaction(async (tx) => {
    const org = await Organization.create({
      name: d.org, code: d.tenantId, type: "Tenant", status: "Active",
      parentOrgId: null, tenantId: null, email: d.email, phone: null, website: null,
      country: d.country, address: null,
    }, { transaction: tx });
    org.tenantId = org.id;
    await org.save({ transaction: tx });

    await Site.create({
      orgId: org.id, code: `${d.tenantId}-SITE`, name: `${d.org} — Demo Site`, type: "Head Office",
      country: d.country, address: null, status: "Active", isPrimary: true,
    }, { transaction: tx });

    const user = await User.create({
      orgId: org.id, tenantId: org.id, fullName: d.name, username: d.username, email: d.email,
      passwordHash: await hashPassword(d.tempPassword), status: "Active",
      position: d.role, workUnit: null, lastLogin: null,
      activationToken: null, resetToken: null, resetExpires: null,
    }, { transaction: tx });

    const role = await Role.create({ name: d.role, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true }, { transaction: tx });
    await (user as unknown as WithSetRoles).setRoles([role], { transaction: tx });
    await grantEverything(role.id, tx);
    await assignSubscription(org.id, "standard", tx);
    await seedDemoLims(org.id, d.modules, tx);

    return { orgId: org.id, userId: user.id };
  });
}

/** Approve + seed the isolated workspace, provision real login credentials, and start the clock. */
export async function generateDemoTenant(auth: AuthContext, id: string, ip: string | null): Promise<DemoTenantView> {
  const d = await resolve(auth, id);
  if (d.accessStatus === "Deleted") throw new BadRequestError("Cannot generate a deleted demo workspace", "DEMO_DELETED");

  if (!d.provisionedOrgId || !d.provisionedUserId) {
    const { orgId, userId } = await provisionRealDemoIdentity(d);
    d.provisionedOrgId = orgId;
    d.provisionedUserId = userId;
  } else {
    // Re-generating an already-provisioned workspace: keep the real login in
    // sync with the temp password still shown to the SP, and reactivate it.
    const user = await User.findByPk(d.provisionedUserId);
    if (user) {
      user.passwordHash = await hashPassword(d.tempPassword);
      user.status = "Active";
      await user.save();
    }
  }

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
  // Rotate the temp password on every resend — since provisionRealDemoIdentity
  // this display value is a real, working login credential, so each resend
  // caps how long a previously-shown password stays valid (does not revoke
  // any session already established with the old one; only blocks its reuse).
  d.tempPassword = randomUUID().slice(0, 12);
  if (d.provisionedUserId) {
    const user = await User.findByPk(d.provisionedUserId);
    if (user) {
      user.passwordHash = await hashPassword(d.tempPassword);
      await user.save();
    }
  }
  await d.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.resent", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}

/**
 * Keeps the real provisioned User's status in lockstep with a DemoTenant
 * lifecycle change, AND revokes every outstanding refresh token when access is
 * revoked — the status flag alone only blocks the next `login()`/`refresh()`
 * call; an already-issued refresh token must be actively killed, or a session
 * obtained before the disable/reject/expiry keeps renewing itself for up to
 * REFRESH_TOKEN_TTL_DAYS regardless of what the DemoTenant row says.
 */
async function syncProvisionedUserStatus(d: DemoTenant, status: "Active" | "Suspended" | "Deleted"): Promise<void> {
  if (!d.provisionedUserId) return;
  const user = await User.findByPk(d.provisionedUserId);
  if (!user) return;
  user.status = status;
  await user.save();
  if (status !== "Active") {
    await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: user.id, revokedAt: null } });
  }
}

export async function extendDemoTenant(auth: AuthContext, id: string, validityHours: number, ip: string | null): Promise<DemoTenantView> {
  const d = await resolve(auth, id);
  if (d.accessStatus === "Deleted") throw new BadRequestError("Cannot extend a deleted demo workspace", "DEMO_DELETED");
  if (!Number.isFinite(validityHours) || validityHours <= 0) throw new BadRequestError("Validity must be a positive number of hours", "INVALID_VALIDITY");
  d.validityHours = validityHours;
  d.expiresAt = new Date(Date.now() + validityHours * HOUR_MS);
  if (d.accessStatus === "Expired" || d.accessStatus === "Archived" || d.accessStatus === "Disabled") {
    d.accessStatus = "Active";
    await syncProvisionedUserStatus(d, "Active");
  }
  await d.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.extended", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}

export async function disableDemoTenant(auth: AuthContext, id: string, ip: string | null): Promise<DemoTenantView> {
  const d = await resolve(auth, id);
  d.accessStatus = "Disabled";
  await syncProvisionedUserStatus(d, "Suspended");
  await d.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.disabled", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}

export async function deleteDemoTenant(auth: AuthContext, id: string, ip: string | null): Promise<DemoTenantView> {
  const d = await resolve(auth, id);
  d.accessStatus = "Deleted";
  await syncProvisionedUserStatus(d, "Deleted");
  d.deletedAt = new Date();
  await d.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "demo.deleted", entityType: "DemoTenant", entityId: d.id, sourceIp: ip, result: "Success" });
  return toView(d);
}
