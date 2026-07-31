import { randomUUID } from "node:crypto";
import { sequelize } from "../../db/sequelize";
import { Organization, RegistrationRequest, User } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import type { RegistrationStatus } from "../../db/models/registrationRequest.model";
import { assignSubscription } from "../subscriptions/subscription.service";
import { sendActivationInvite } from "../notifications/notification.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface ProposedTenant {
  name: string;
  code: string;
  email?: string;
  country?: string;
  adminFullName: string;
  adminUsername: string;
  adminEmail: string;
}

export interface RegistrationView {
  id: string;
  distributorOrgId: string;
  distributorName: string;
  proposedTenant: Record<string, unknown>;
  status: RegistrationStatus;
  decisionReason: string | null;
  submittedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  const orgIds = [...new Set(rows.map((r) => r.distributorOrgId))];
  const orgs = await Organization.findAll({ where: { id: orgIds } });
  const nameById = new Map(orgs.map((o) => [o.id, o.name]));
  return rows.map((r) => ({
    id: r.id,
    distributorOrgId: r.distributorOrgId,
    distributorName: nameById.get(r.distributorOrgId) ?? "—",
    proposedTenant: r.proposedTenant,
    status: r.status,
    decisionReason: r.decisionReason,
    submittedBy: r.submittedBy,
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
 * Owner may raise a Direct one (OD's "+ New Request" exists for both).
 * `asDraft` keeps it editable before it enters the review queue.
 */
export async function submitRegistration(
  auth: AuthContext, proposed: ProposedTenant, ip: string | null, asDraft = false,
): Promise<RegistrationRequest> {
  if (auth.orgType !== "Distributor" && auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only partners or the Service Owner may raise tenant requests");
  }
  const req = await RegistrationRequest.create({
    distributorOrgId: auth.orgId,
    submittedBy: auth.orgId,
    proposedTenant: proposed as unknown as Record<string, unknown>,
    status: asDraft ? "Draft" : "Submitted",
    decisionReason: null,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
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
  auth: AuthContext, id: string, proposed: Partial<ProposedTenant>, ip: string | null,
): Promise<RegistrationView> {
  const req = await requireRequest(auth, id);
  if (req.status === "Approved" || req.status === "Rejected" || req.status === "Cancelled") {
    throw new BadRequestError("This request has already been decided", "REQUEST_DECIDED");
  }
  req.proposedTenant = { ...(req.proposedTenant ?? {}), ...proposed };
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
    actorUserId: auth.userId, organizationId: auth.orgId, action: `registration.${next.toLowerCase().replace(/ /g, "_")}`,
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

  // The monolith equivalent of the PRD saga: one transaction creates the tenant,
  // assigns a subscription, and creates the initial Tenant Administrator.
  const org = await sequelize.transaction(async (tx) => {
    const tenant = await Organization.create(
      {
        name: p.name, code: p.code, type: "Tenant", status: "Active",
        parentOrgId: req.distributorOrgId, tenantId: null,
        email: p.email ?? null, phone: null, website: null, country: p.country ?? null, address: null,
      },
      { transaction: tx },
    );
    tenant.tenantId = tenant.id;
    await tenant.save({ transaction: tx });

    await assignSubscription(tenant.id, "standard", tx);

    const activationToken = randomUUID();
    const admin = await User.create(
      {
        orgId: tenant.id, tenantId: tenant.id, fullName: p.adminFullName, username: p.adminUsername, email: p.adminEmail,
        passwordHash: null, status: "PendingActivation", position: "Administrator", workUnit: null,
        lastLogin: null, activationToken, resetToken: null, resetExpires: null,
      },
      { transaction: tx },
    );

    req.status = "Approved";
    await req.save({ transaction: tx });

    await writeAudit(
      { actorUserId: auth.userId, organizationId: tenant.id, tenantId: tenant.id, action: "org.approved", entityType: "Organization", entityId: tenant.id, sourceIp: ip, result: "Success" },
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
