import { randomUUID } from "node:crypto";
import type { Transaction } from "sequelize";
import { sequelize } from "../../db/sequelize";
import { Organization, RegistrationRequest, User, Role } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import type { RegistrationStatus } from "../../db/models/registrationRequest.model";
import { assignSubscription } from "../subscriptions/subscription.service";
import { sendActivationInvite } from "../notifications/notification.service";
import { writeAudit } from "../audit/audit.service";
import { grantEverythingExceptSpOnly } from "../iam/tenantGrants";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

// belongsToMany generates a `setRoles` mixin at runtime; the User model does
// not declare it, so reach it through a narrow association-only cast (mirrors
// `src/db/seeders/seed.ts`'s `WithSetRoles` / `tenant.service.ts`'s).
type WithSetRoles = { setRoles: (roles: Role[], options?: { transaction?: Transaction }) => Promise<unknown> };

export interface ProposedTenant {
  name: string;
  code: string;
  email?: string;
  country?: string;
  /** OD `INDUSTRIES` select (7711) — organization-level, not per-admin. */
  industry?: string;
  /** OD "Contact Phone" (7716). */
  phone?: string;
  adminFullName: string;
  adminUsername: string;
  adminEmail: string;
}

export interface RegistrationView {
  id: string;
  code: string;
  distributorOrgId: string | null;
  distributorName: string;
  proposedTenant: Record<string, unknown>;
  status: RegistrationStatus;
  decisionReason: string | null;
  submittedBy: string | null;
  tenantId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

async function nextRequestCode(): Promise<string> {
  const rows = await RegistrationRequest.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = Number.parseInt((r.code ?? "").replace(/^TRQ-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `TRQ-${max + 1}`;
}

/** OD `TREQ_STATUSES` transitions. Approve/reject live in their own functions. */
const NEXT: Record<string, RegistrationStatus[]> = {
  Draft: ["Submitted", "Cancelled"],
  Submitted: ["Under Review", "Cancelled"],
  "Under Review": ["Submitted", "Cancelled"],
  PendingApproval: ["Under Review", "Cancelled"],
};

/** Statuses an SO may still act on. */
const REVIEWABLE: RegistrationStatus[] = ["Submitted", "Under Review", "PendingApproval"];

/**
 * List registration requests visible to the actor (ServiceOwner sees all;
 * a Distributor sees only its own), enriched with the distributor org name.
 */
export async function listRegistrations(
  auth: AuthContext,
  status?: RegistrationStatus,
): Promise<RegistrationView[]> {
  const where: Record<string, unknown> = {};
  if (auth.orgType === "Distributor") where.distributorOrgId = auth.orgId;
  if (auth.orgType === "Tenant") return [];
  if (status) where.status = status;
  const rows = await RegistrationRequest.findAll({ where, order: [["createdAt", "DESC"]] });
  const orgIds = [...new Set(rows.map((r) => r.distributorOrgId).filter((id): id is string => id !== null))];
  const orgs = await Organization.findAll({ where: { id: orgIds } });
  const nameById = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    distributorOrgId: r.distributorOrgId,
    // OD's Direct-vs-Partner label (7738, 7695) — null distributorOrgId is a
    // Service-Owner-raised request with no acquiring partner.
    distributorName: r.distributorOrgId ? (nameById.get(r.distributorOrgId) ?? "—") : "Direct",
    proposedTenant: r.proposedTenant,
    status: r.status,
    decisionReason: r.decisionReason,
    submittedBy: r.submittedBy,
    tenantId: r.tenantId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

async function requireRequest(auth: AuthContext, id: string): Promise<RegistrationRequest> {
  const req = await RegistrationRequest.findByPk(id);
  if (!req) throw new NotFoundError("Registration request not found");
  // A partner may only touch its own; the Service Owner sees everything.
  if (auth.orgType === "Distributor" && req.distributorOrgId !== auth.orgId) throw new ForbiddenError();
  if (auth.orgType === "Tenant") throw new ForbiddenError();
  return req;
}

/**
 * Create a request. Partners raise them against their own org; the Service
 * Owner may raise one on behalf of an explicit partner, or leave `partnerOrgId`
 * unset for OD's "Direct (Service Provider acquisition)" (7713). A partner
 * caller can never set another org's id here — theirs is always used.
 * `asDraft` keeps it editable before it enters the review queue.
 */
export async function submitRegistration(
  auth: AuthContext, proposed: ProposedTenant, ip: string | null, asDraft = false, partnerOrgId?: string | null,
): Promise<RegistrationRequest> {
  if (auth.orgType !== "Distributor" && auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only partners or the Service Owner may raise tenant requests");
  }
  const distributorOrgId = auth.orgType === "Distributor" ? auth.orgId : (partnerOrgId ?? null);
  if (distributorOrgId) {
    const partner = await Organization.findOne({ where: { id: distributorOrgId, type: "Distributor" } });
    if (!partner) throw new BadRequestError("Selected partner does not exist", "PARTNER_NOT_FOUND");
  }
  const req = await RegistrationRequest.create({
    code: await nextRequestCode(),
    distributorOrgId,
    submittedBy: auth.orgId,
    proposedTenant: proposed as unknown as Record<string, unknown>,
    status: asDraft ? "Draft" : "Submitted",
    decisionReason: null,
    tenantId: null,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: distributorOrgId,
    action: "registration.submitted",
    entityType: "RegistrationRequest",
    entityId: req.id,
    sourceIp: ip,
    result: "Success",
  });
  return req;
}

/** Edit a request that has not been decided yet (OD allows editing a Draft). */
export async function updateRegistration(
  auth: AuthContext, id: string, proposed: Partial<ProposedTenant>, ip: string | null, partnerOrgId?: string | null,
): Promise<RegistrationView> {
  const req = await requireRequest(auth, id);
  if (req.status === "Approved" || req.status === "Rejected" || req.status === "Cancelled") {
    throw new BadRequestError("This request has already been decided", "REQUEST_DECIDED");
  }
  req.proposedTenant = { ...(req.proposedTenant ?? {}), ...proposed };
  // Only the Service Owner may reassign the acquiring partner (or Direct); a
  // partner's own request always stays attributed to their own org.
  if (auth.orgType === "ServiceOwner" && partnerOrgId !== undefined) {
    req.distributorOrgId = partnerOrgId;
  }
  await req.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: auth.orgId, action: "registration.updated",
    entityType: "RegistrationRequest", entityId: req.id, sourceIp: ip, result: "Success",
  });
  return (await listRegistrations(auth)).find((r) => r.id === req.id)!;
}

/**
 * Move a request along OD's lifecycle (submit a draft, take it under review,
 * send it back, or cancel). Approve/reject remain separate SO-only decisions.
 */
export async function transitionRegistration(
  auth: AuthContext, id: string, next: RegistrationStatus, ip: string | null,
): Promise<RegistrationView> {
  const req = await requireRequest(auth, id);
  const allowed = NEXT[req.status] ?? [];
  if (!allowed.includes(next)) {
    throw new BadRequestError(`Cannot move a ${req.status} request to ${next}`, "INVALID_TRANSITION");
  }
  // Only the reviewer takes something under review.
  if (next === "Under Review" && auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can review tenant requests");
  }
  req.status = next;
  await req.save();
  await writeAudit({
    // Stamped against the request's own org (null for Direct) rather than the
    // actor's — otherwise an SO taking a partner's request "Under Review"
    // would leave an entry the partner's own org-scoped audit query can never see.
    actorUserId: auth.userId, organizationId: req.distributorOrgId, action: `registration.${next.toLowerCase().replace(/ /g, "_")}`,
    entityType: "RegistrationRequest", entityId: req.id, sourceIp: ip, result: "Success",
  });
  return (await listRegistrations(auth)).find((r) => r.id === req.id)!;
}

export async function approveRegistration(auth: AuthContext, requestId: string, ip: string | null): Promise<Organization> {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner can approve registrations");
  const req = await RegistrationRequest.findByPk(requestId);
  if (!req) throw new NotFoundError("Registration request not found");
  if (!REVIEWABLE.includes(req.status)) throw new BadRequestError("Request is not awaiting a decision", "NOT_REVIEWABLE");

  const p = req.proposedTenant as unknown as ProposedTenant;
  // Direct requests (no partner) parent to the Service Owner's own org, same
  // fallback tenant.service.ts's provisionTenant uses for a Direct tenant.
  const parentOrgId = req.distributorOrgId ?? auth.orgId;

  // The monolith equivalent of the PRD saga: one transaction creates the tenant,
  // assigns a subscription, and creates the initial Tenant Administrator.
  const org = await sequelize.transaction(async (tx) => {
    const tenant = await Organization.create(
      {
        name: p.name, code: p.code, type: "Tenant", status: "Active",
        parentOrgId, tenantId: null,
        email: p.email ?? null, phone: p.phone ?? null, website: null, country: p.country ?? null, address: null,
        industry: p.industry ?? null,
      },
      { transaction: tx },
    );
    tenant.tenantId = tenant.id;
    await tenant.save({ transaction: tx });

    await assignSubscription(tenant.id, "standard", tx);

    // Administrator role for the new tenant org, granted the same curated
    // non-SP action set the seeder gives its demo Distributor/Tenant admins
    // (`grantEverythingExceptSpOnly`) — without this the admin user below has
    // zero action grants and every authenticated request 403s (same defect
    // as `tenant.service.ts`'s `provisionTenant`, fixed there in lockstep).
    const role = await Role.create(
      { name: "Administrator", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true },
      { transaction: tx },
    );
    await grantEverythingExceptSpOnly(role.id, tx);

    const activationToken = randomUUID();
    const admin = await User.create(
      {
        orgId: tenant.id, tenantId: tenant.id, fullName: p.adminFullName, username: p.adminUsername, email: p.adminEmail,
        passwordHash: null, status: "Pending Activation", position: "Administrator", workUnit: null,
        lastLogin: null, activationToken, resetToken: null, resetExpires: null,
      },
      { transaction: tx },
    );
    await (admin as unknown as WithSetRoles).setRoles([role], { transaction: tx });

    req.status = "Approved";
    req.tenantId = tenant.id;
    await req.save({ transaction: tx });

    await writeAudit(
      { actorUserId: auth.userId, organizationId: tenant.id, tenantId: tenant.id, action: "org.approved", entityType: "Organization", entityId: tenant.id, sourceIp: ip, result: "Success" },
      tx,
    );
    // A distinct entry on the request itself (OD `treqAudit`, 7647) — the
    // Request Timeline otherwise has no record that it was ever provisioned.
    await writeAudit(
      {
        actorUserId: auth.userId, organizationId: req.distributorOrgId, action: "registration.approved",
        entityType: "RegistrationRequest", entityId: req.id, sourceIp: ip, result: "Success",
        metadata: { tenantId: tenant.id },
      },
      tx,
    );

    // Side effect after the row is staged; safe because invite is idempotent-ish (stub).
    sendActivationInvite(admin.email, activationToken);
    return tenant;
  });

  return org;
}

export async function rejectRegistration(auth: AuthContext, requestId: string, reason: string, ip: string | null): Promise<RegistrationRequest> {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner can reject registrations");
  const req = await RegistrationRequest.findByPk(requestId);
  if (!req) throw new NotFoundError("Registration request not found");
  if (!REVIEWABLE.includes(req.status)) throw new BadRequestError("Request is not awaiting a decision", "NOT_REVIEWABLE");
  req.status = "Rejected";
  req.decisionReason = reason;
  await req.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: req.distributorOrgId,
    action: "registration.rejected",
    entityType: "RegistrationRequest",
    entityId: req.id,
    sourceIp: ip,
    result: "Success",
    metadata: { reason },
  });
  return req;
}
