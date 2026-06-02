import { randomUUID } from "node:crypto";
import { sequelize } from "../../db/sequelize";
import { Organization, RegistrationRequest, User } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
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

export async function submitRegistration(auth: AuthContext, proposed: ProposedTenant, ip: string | null): Promise<RegistrationRequest> {
  if (auth.orgType !== "Distributor") throw new ForbiddenError("Only distributors may submit tenant registrations");
  const req = await RegistrationRequest.create({
    distributorOrgId: auth.orgId,
    proposedTenant: proposed as unknown as Record<string, unknown>,
    status: "PendingApproval",
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

export async function approveRegistration(auth: AuthContext, requestId: string, ip: string | null): Promise<Organization> {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner can approve registrations");
  const req = await RegistrationRequest.findByPk(requestId);
  if (!req) throw new NotFoundError("Registration request not found");
  if (req.status !== "PendingApproval") throw new BadRequestError("Request is not pending");

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
  if (req.status !== "PendingApproval") throw new BadRequestError("Request is not pending");
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
