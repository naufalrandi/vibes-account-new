import { randomUUID } from "node:crypto";
import { Op, type WhereOptions, type Transaction } from "sequelize";
import { sequelize } from "../../db/sequelize";
import {
  Organization,
  User,
  PartnerProfile,
  PartnerAgreement,
  AgreementTemplate,
  RevenueShareStatement,
  Payout,
  Subscription,
  Role,
} from "../../db/models";
import type { PartnerStatus, PartnerTier, PartnerAuditEntry } from "../../db/models/partnerProfile.model";
import type { AuthContext } from "../../lib/scope";
import { organizationScopeWhere, canActOnOrg } from "../../lib/scope";
import { renderBlocks } from "../agreements/agreement.service";
import { sendActivationInvite } from "../notifications/notification.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { grantEverythingExceptSpOnly } from "../iam/tenantGrants";

// A freshly created Partner Administrator needs an actual Role + grants, or
// every authenticated request 403s post-activation (same defect class as
// tenant.service.ts's provisionTenant / registration.service.ts's
// approveRegistration, fixed here in lockstep — certification audit finding).
type WithSetRoles = { setRoles: (roles: Role[], options?: { transaction?: Transaction }) => Promise<unknown> };

// --- DTO shapes (match the FE contract exactly) --------------------------
export interface PartnerView {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  country: string | null;
  address: string | null;
  status: PartnerStatus;
  tier: PartnerTier | null;
  tenantCount: number;
  admin: { fullName: string; username: string; email: string | null; status: string } | null;
  audit: PartnerAuditEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PartnerTeamMember { userId: string; fullName: string; email: string; roleGroup: string; status: string }
export interface PartnerTenantRow { id: string; name: string; code: string | null; status: string; subscription: string; renewal: string }
export interface PartnerBillingView {
  tier: PartnerTier | null;
  summary: { acquiredTenants: number; totalEarned: number; paidOut: number; pending: number };
  statements: { id: string; period: string; totalRev: number; pct: number; partnerShare: number; axiaShare: number; status: string }[];
  payouts: { id: string; statement: string; period: string; amount: number; date: string; status: string }[];
}

export interface CreatePartnerInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  country?: string | null;
  address?: string | null;
  tier?: PartnerTier;
  admin: { fullName: string; username: string; email: string };
  mode?: "draft" | "send";
  agreement?: { templateId: string; vars?: Record<string, string> };
}

export type UpdatePartnerInput = Partial<Omit<CreatePartnerInput, "admin" | "mode" | "agreement">>;

function toView(org: Organization, profile: PartnerProfile, tenantCount: number, admin: PartnerView["admin"] = null): PartnerView {
  return {
    id: org.id,
    code: profile.code,
    name: org.name,
    email: org.email,
    phone: org.phone,
    website: org.website,
    country: org.country,
    address: org.address,
    status: profile.status,
    tier: profile.tier,
    tenantCount,
    admin,
    audit: profile.audit,
    createdAt: org.createdAt,
    updatedAt: profile.updatedAt,
  };
}

async function adminOf(profile: PartnerProfile): Promise<PartnerView["admin"]> {
  if (!profile.adminUserId) return null;
  const u = await User.findByPk(profile.adminUserId);
  return u ? { fullName: u.fullName, username: u.username, email: u.email, status: u.status } : null;
}

function nowEntry(msg: string): PartnerAuditEntry {
  return { ts: new Date().toISOString(), msg };
}

async function tenantCountFor(orgId: string): Promise<number> {
  return Organization.count({ where: { type: "Tenant", parentOrgId: orgId } });
}

/** Next `PRT-####` code (max existing numeric suffix + 1, starting at 1001). */
async function nextPartnerCode(): Promise<string> {
  const rows = await PartnerProfile.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^PRT-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `PRT-${max + 1}`;
}

/** Resolve a partner (Distributor org + profile) the actor may see, or 404/403. */
async function resolvePartner(auth: AuthContext, orgId: string): Promise<{ org: Organization; profile: PartnerProfile }> {
  const org = await Organization.findByPk(orgId);
  if (!org || org.type !== "Distributor") throw new NotFoundError("Partner does not exist", "PARTNER_NOT_FOUND");
  if (!canActOnOrg(auth, org.id, org.parentOrgId)) throw new ForbiddenError();
  const profile = await PartnerProfile.findOne({ where: { orgId } });
  if (!profile) throw new NotFoundError("Partner profile missing", "PARTNER_NOT_FOUND");
  return { org, profile };
}

export async function listPartners(
  auth: AuthContext,
  filters: { status?: PartnerStatus; country?: string; search?: string } = {},
): Promise<PartnerView[]> {
  const orgWhere: WhereOptions = { ...organizationScopeWhere(auth), type: "Distributor" };
  if (filters.country) Object.assign(orgWhere, { country: filters.country });
  if (filters.search) {
    const term = `%${filters.search}%`;
    Object.assign(orgWhere, { [Op.or]: [{ name: { [Op.iLike]: term } }, { email: { [Op.iLike]: term } }] });
  }
  const orgs = await Organization.findAll({ where: orgWhere, order: [["createdAt", "DESC"]] });
  const views: PartnerView[] = [];
  for (const org of orgs) {
    const profile = await PartnerProfile.findOne({ where: { orgId: org.id } });
    if (!profile) continue;
    if (filters.status && profile.status !== filters.status) continue;
    if (filters.search && filters.search.startsWith("PRT-") && profile.code !== filters.search) {
      // a code search also matches; handled loosely above on name/email
    }
    views.push(toView(org, profile, await tenantCountFor(org.id)));
  }
  return views;
}

export async function getPartner(auth: AuthContext, orgId: string): Promise<PartnerView> {
  const { org, profile } = await resolvePartner(auth, orgId);
  return toView(org, profile, await tenantCountFor(org.id), await adminOf(profile));
}

/** Partner team members (the partner org's users; read-only SP view). */
export async function getPartnerTeam(auth: AuthContext, orgId: string): Promise<PartnerTeamMember[]> {
  const { profile } = await resolvePartner(auth, orgId);
  const users = await User.findAll({ where: { orgId }, order: [["createdAt", "ASC"]] });
  return users.map((u) => ({ userId: u.id, fullName: u.fullName, email: u.email, roleGroup: u.id === profile.adminUserId ? "Administrator" : "Member", status: u.status }));
}

/** Tenants acquired by this partner (child Tenant orgs). */
export async function getPartnerTenants(auth: AuthContext, orgId: string): Promise<PartnerTenantRow[]> {
  await resolvePartner(auth, orgId);
  const tenants = await Organization.findAll({ where: { type: "Tenant", parentOrgId: orgId }, order: [["name", "ASC"]] });
  const subs = new Map((await Subscription.findAll({ where: { orgId: { [Op.in]: tenants.length ? tenants.map((t) => t.id) : ["__none__"] } } })).map((s) => [s.orgId, s]));
  return tenants.map((t) => {
    const s = subs.get(t.id);
    return { id: t.id, name: t.name, code: t.code, status: t.status, subscription: s?.plan ?? "—", renewal: s?.endDate ? new Date(s.endDate).toISOString().slice(0, 10) : "—" };
  });
}

/** Partner billing: revenue-share statements, payouts, and the payout summary. */
export async function getPartnerBilling(auth: AuthContext, orgId: string): Promise<PartnerBillingView> {
  const { profile } = await resolvePartner(auth, orgId);
  const stmts = await RevenueShareStatement.findAll({ where: { partnerOrgId: orgId }, order: [["createdAt", "DESC"]] });
  const pays = await Payout.findAll({ where: { partnerOrgId: orgId }, include: [{ model: RevenueShareStatement, attributes: ["code"] }], order: [["createdAt", "DESC"]] });
  const n = (v: number | string) => Number(v);
  const statements = stmts.map((s) => ({ id: s.code, period: s.period, totalRev: n(s.totalRev), pct: s.pct, partnerShare: n(s.partnerShare), axiaShare: n(s.axiaShare), status: s.status }));
  const paidOut = statements.filter((s) => s.status === "Paid").reduce((a, s) => a + s.partnerShare, 0);
  const pending = statements.filter((s) => s.status === "Pending" || s.status === "Approved").reduce((a, s) => a + s.partnerShare, 0);
  const totalEarned = statements.reduce((a, s) => a + s.partnerShare, 0);
  const payouts = pays.map((p) => ({ id: p.code, statement: (p as unknown as { RevenueShareStatement?: { code: string } }).RevenueShareStatement?.code ?? "—", period: p.period, amount: n(p.amount), date: p.date ?? "—", status: p.status }));
  return { tier: profile.tier, summary: { acquiredTenants: await tenantCountFor(orgId), totalEarned, paidOut, pending }, statements, payouts };
}

export async function createPartner(
  auth: AuthContext,
  input: CreatePartnerInput,
  ip: string | null,
): Promise<PartnerView> {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner can create partners");
  const send = input.mode === "send";
  const code = await nextPartnerCode();

  const view = await sequelize.transaction(async (tx) => {
    const org = await Organization.create(
      {
        name: input.name,
        code,
        type: "Distributor",
        status: send ? "PendingApproval" : "Draft",
        parentOrgId: auth.orgId,
        tenantId: null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        website: input.website ?? null,
        country: input.country ?? null,
        address: input.address ?? null,
        legalName: null,
        industry: null,
        contactName: null,
        contactEmail: null,
        contactPhone: null,
        taxId: null,
        branding: null,
        systemDefaults: null,
      },
      { transaction: tx },
    );

    const role = await Role.create(
      { name: "Administrator", tierScope: "Distributor", orgId: org.id, isSuperAdmin: false, status: true },
      { transaction: tx },
    );
    await grantEverythingExceptSpOnly(role.id, tx);

    const activationToken = randomUUID();
    const admin = await User.create(
      {
        orgId: org.id,
        tenantId: null,
        fullName: input.admin.fullName,
        username: input.admin.username,
        email: input.admin.email,
        passwordHash: null,
        status: "PendingActivation",
        position: "Partner Administrator",
        workUnit: null,
        lastLogin: null,
        activationToken,
        resetToken: null,
        resetExpires: null,
      },
      { transaction: tx },
    );
    await (admin as unknown as WithSetRoles).setRoles([role], { transaction: tx });

    const audit: PartnerAuditEntry[] = [nowEntry("Partner organization created")];
    const profile = await PartnerProfile.create(
      {
        orgId: org.id,
        code,
        tier: input.tier ?? null,
        status: send ? "Pending Approval" : "Draft",
        adminUserId: admin.id,
        commercialSummary: null,
        audit,
      },
      { transaction: tx },
    );

    if (send && input.agreement) {
      await generateForPartner(org, profile, input.agreement.templateId, input.agreement.vars ?? {}, tx);
    }

    await writeAudit(
      {
        actorUserId: auth.userId,
        organizationId: org.id,
        action: "partner.created",
        entityType: "Partner",
        entityId: org.id,
        sourceIp: ip,
        result: "Success",
        metadata: { code, mode: input.mode ?? "draft" },
      },
      tx,
    );
    sendActivationInvite(admin.email, activationToken);
    return toView(org, profile, 0, { fullName: admin.fullName, username: admin.username, email: admin.email, status: admin.status });
  });
  return view;
}

export async function updatePartner(
  auth: AuthContext,
  orgId: string,
  input: UpdatePartnerInput,
  ip: string | null,
): Promise<PartnerView> {
  const { org, profile } = await resolvePartner(auth, orgId);
  if (input.name !== undefined) org.name = input.name;
  if (input.email !== undefined) org.email = input.email ?? null;
  if (input.phone !== undefined) org.phone = input.phone ?? null;
  if (input.website !== undefined) org.website = input.website ?? null;
  if (input.country !== undefined) org.country = input.country ?? null;
  if (input.address !== undefined) org.address = input.address ?? null;
  await org.save();
  if (input.tier !== undefined) {
    profile.tier = input.tier ?? null;
    await profile.save();
  }
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: org.id,
    action: "partner.updated",
    entityType: "Partner",
    entityId: org.id,
    sourceIp: ip,
    result: "Success",
  });
  return toView(org, profile, await tenantCountFor(org.id), await adminOf(profile));
}

// --- Lifecycle transitions -----------------------------------------------
const ORG_STATUS_FOR: Record<string, Organization["status"]> = {
  Active: "Active",
  Suspended: "Suspended",
  Terminated: "Inactive",
};

async function transition(
  auth: AuthContext,
  orgId: string,
  opts: { from: PartnerStatus[]; to: PartnerStatus; action: string; msg: string },
  ip: string | null,
): Promise<PartnerView> {
  const { org, profile } = await resolvePartner(auth, orgId);
  if (!opts.from.includes(profile.status)) {
    throw new ConflictError(
      `Cannot ${opts.action} a partner in status "${profile.status}"`,
      "ILLEGAL_TRANSITION",
    );
  }
  profile.status = opts.to;
  profile.audit = [nowEntry(opts.msg), ...profile.audit];
  await profile.save();
  const orgStatus = ORG_STATUS_FOR[opts.to];
  if (orgStatus) {
    org.status = orgStatus;
    await org.save();
  }
  // Terminating a partner also terminates its current agreement.
  if (opts.to === "Terminated") {
    const ag = await PartnerAgreement.findOne({ where: { orgId } });
    if (ag && ag.status !== "Terminated") {
      ag.status = "Terminated";
      ag.history = [...ag.history, { date: new Date().toISOString().slice(0, 10), event: "Agreement Terminated" }];
      await ag.save();
    }
  }
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: org.id,
    action: `partner.${opts.action}`,
    entityType: "Partner",
    entityId: org.id,
    sourceIp: ip,
    result: "Success",
  });
  return toView(org, profile, await tenantCountFor(org.id), await adminOf(profile));
}

/**
 * Resend (or send, if never sent) the activation invite email to the Partner
 * Administrator. Only valid while the partner is Approved — i.e. the
 * agreement is signed and awaiting the admin to activate their account.
 * Mirrors tenant.service.resendActivation.
 */
export async function resendPartnerActivation(auth: AuthContext, orgId: string, ip: string | null): Promise<PartnerView> {
  const { org, profile } = await resolvePartner(auth, orgId);
  if (profile.status !== "Approved") {
    throw new ConflictError(
      `Cannot resend activation for a partner in status "${profile.status}"`,
      "ILLEGAL_TRANSITION",
    );
  }
  const admin = profile.adminUserId ? await User.findByPk(profile.adminUserId) : null;
  if (!admin) throw new NotFoundError("Partner administrator missing", "PARTNER_ADMIN_NOT_FOUND");
  const token = admin.activationToken ?? randomUUID();
  admin.activationToken = token;
  await admin.save();
  sendActivationInvite(admin.email, token);
  profile.audit = [nowEntry(`Activation email sent to ${admin.email}`), ...profile.audit];
  await profile.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: org.id,
    action: "partner.activation-resent",
    entityType: "Partner",
    entityId: org.id,
    sourceIp: ip,
    result: "Success",
  });
  return toView(org, profile, await tenantCountFor(org.id), await adminOf(profile));
}

export const activatePartner = (auth: AuthContext, orgId: string, ip: string | null) =>
  transition(auth, orgId, { from: ["Approved"], to: "Active", action: "activated", msg: "Partner activated" }, ip);
export const suspendPartner = (auth: AuthContext, orgId: string, ip: string | null) =>
  transition(auth, orgId, { from: ["Active"], to: "Suspended", action: "suspended", msg: "Partner suspended" }, ip);
export const resumePartner = (auth: AuthContext, orgId: string, ip: string | null) =>
  transition(auth, orgId, { from: ["Suspended"], to: "Active", action: "resumed", msg: "Partner resumed" }, ip);
export const terminatePartner = (auth: AuthContext, orgId: string, ip: string | null) =>
  transition(
    auth,
    orgId,
    { from: ["Draft", "Pending Approval", "Approved", "Active", "Suspended"], to: "Terminated", action: "terminated", msg: "Partnership terminated" },
    ip,
  );

// --- Per-partner agreement -----------------------------------------------
async function nextAgreementNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `AGR-${year}-`;
  const count = await PartnerAgreement.count({ where: { number: { [Op.like]: `${prefix}%` } } });
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

/**
 * Create-or-replace the partner's current agreement from a template, rendering
 * the block snapshot and moving the partner to Pending Approval. Shared by
 * createPartner (send mode) and the explicit generate endpoint.
 */
async function generateForPartner(
  org: Organization,
  profile: PartnerProfile,
  templateId: string,
  vars: Record<string, string>,
  tx?: import("sequelize").Transaction,
): Promise<PartnerAgreement> {
  const template = await AgreementTemplate.findByPk(templateId, { transaction: tx });
  if (!template) throw new BadRequestError("Agreement template does not exist", "TEMPLATE_NOT_FOUND");
  const number = await nextAgreementNumber();
  const rendered = renderBlocks(template.blocks, vars);
  const today = new Date().toISOString().slice(0, 10);

  const existing = await PartnerAgreement.findOne({ where: { orgId: org.id }, transaction: tx });
  let agreement: PartnerAgreement;
  if (existing) {
    existing.templateId = template.id;
    existing.templateName = template.name;
    existing.number = number;
    existing.version = template.version;
    existing.status = "Pending Approval";
    existing.vars = vars;
    existing.renderedBlocks = rendered;
    existing.history = [...existing.history, { date: today, event: "Agreement Generated" }];
    await existing.save({ transaction: tx });
    agreement = existing;
  } else {
    agreement = await PartnerAgreement.create(
      {
        orgId: org.id,
        templateId: template.id,
        templateName: template.name,
        number,
        version: template.version,
        status: "Pending Approval",
        effectiveDate: null,
        expirationDate: null,
        vars,
        renderedBlocks: rendered,
        history: [{ date: today, event: "Agreement Generated" }],
      },
      { transaction: tx },
    );
  }

  // Move the partner into Pending Approval (from Draft) and record it.
  if (profile.status === "Draft") {
    profile.status = "Pending Approval";
    org.status = "PendingApproval";
    await org.save({ transaction: tx });
  }
  profile.audit = [nowEntry(`Partnership agreement ${number} generated & sent`), ...profile.audit];
  await profile.save({ transaction: tx });
  return agreement;
}

export async function getPartnerAgreement(auth: AuthContext, orgId: string): Promise<PartnerAgreement | null> {
  await resolvePartner(auth, orgId);
  return PartnerAgreement.findOne({ where: { orgId } });
}

export async function generateAgreement(
  auth: AuthContext,
  orgId: string,
  input: { templateId: string; vars?: Record<string, string> },
  ip: string | null,
): Promise<PartnerAgreement> {
  const { org, profile } = await resolvePartner(auth, orgId);
  const agreement = await generateForPartner(org, profile, input.templateId, input.vars ?? {});
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: org.id,
    action: "partner.agreement.generated",
    entityType: "PartnerAgreement",
    entityId: agreement.id,
    sourceIp: ip,
    result: "Success",
  });
  return agreement;
}

async function requireAgreement(auth: AuthContext, orgId: string): Promise<PartnerAgreement> {
  await resolvePartner(auth, orgId);
  const ag = await PartnerAgreement.findOne({ where: { orgId } });
  if (!ag) throw new NotFoundError("No agreement to act on", "AGREEMENT_NOT_FOUND");
  return ag;
}

export async function regenerateAgreement(auth: AuthContext, orgId: string, ip: string | null): Promise<PartnerAgreement> {
  const ag = await requireAgreement(auth, orgId);
  if (ag.status === "Terminated") throw new ConflictError("Agreement is terminated", "ILLEGAL_TRANSITION");
  const template = ag.templateId ? await AgreementTemplate.findByPk(ag.templateId) : null;
  if (template) ag.renderedBlocks = renderBlocks(template.blocks, ag.vars);
  ag.history = [...ag.history, { date: new Date().toISOString().slice(0, 10), event: "Agreement Regenerated" }];
  await ag.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: orgId,
    action: "partner.agreement.regenerated",
    entityType: "PartnerAgreement",
    entityId: ag.id,
    sourceIp: ip,
    result: "Success",
  });
  return ag;
}

export async function resendAgreement(auth: AuthContext, orgId: string, ip: string | null): Promise<PartnerAgreement> {
  const ag = await requireAgreement(auth, orgId);
  if (ag.status !== "Pending Approval") throw new ConflictError("Agreement is not pending", "ILLEGAL_TRANSITION");
  ag.history = [...ag.history, { date: new Date().toISOString().slice(0, 10), event: "Agreement Resent" }];
  await ag.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: orgId,
    action: "partner.agreement.resent",
    entityType: "PartnerAgreement",
    entityId: ag.id,
    sourceIp: ip,
    result: "Success",
  });
  return ag;
}

export async function approveAgreement(auth: AuthContext, orgId: string, ip: string | null): Promise<PartnerAgreement> {
  const { profile } = await resolvePartner(auth, orgId);
  const ag = await PartnerAgreement.findOne({ where: { orgId } });
  if (!ag) throw new NotFoundError("No agreement to approve", "AGREEMENT_NOT_FOUND");
  if (ag.status !== "Pending Approval") throw new ConflictError("Agreement is not pending", "ILLEGAL_TRANSITION");
  const today = new Date().toISOString().slice(0, 10);
  ag.status = "Approved";
  ag.effectiveDate = ag.effectiveDate ?? today;
  ag.history = [...ag.history, { date: today, event: "Agreement Approved by Partner" }];
  await ag.save();
  // The partner advances to Approved (ready to activate).
  if (profile.status === "Pending Approval") {
    profile.status = "Approved";
    profile.audit = [nowEntry("Partnership agreement approved"), ...profile.audit];
    await profile.save();
  }
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: orgId,
    action: "partner.agreement.approved",
    entityType: "PartnerAgreement",
    entityId: ag.id,
    sourceIp: ip,
    result: "Success",
  });
  return ag;
}
