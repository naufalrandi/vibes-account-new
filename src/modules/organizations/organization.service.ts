import { type WhereOptions } from "sequelize";
import { Organization } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { organizationScopeWhere, canActOnOrg } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateOrgInput {
  name: string;
  code: string;
  type: "Distributor" | "Tenant";
  email?: string | null;
  country?: string | null;
  parentOrgId?: string | null;
}

export async function listOrganizations(auth: AuthContext): Promise<Organization[]> {
  const where: WhereOptions = organizationScopeWhere(auth);
  return Organization.findAll({ where, order: [["createdAt", "DESC"]] });
}

export async function getOrganization(auth: AuthContext, id: string): Promise<Organization> {
  const org = await Organization.findByPk(id);
  if (!org) throw new NotFoundError("Organization does not exist", "ORG_NOT_FOUND");
  if (!canActOnOrg(auth, org.id, org.parentOrgId)) throw new ForbiddenError();
  return org;
}

export async function createOrganization(auth: AuthContext, input: CreateOrgInput, ip: string | null): Promise<Organization> {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner can create organizations directly");
  const dup = await Organization.findOne({ where: { code: input.code } });
  if (dup) throw new ConflictError("Organization code already exists", "DUPLICATE_CODE");

  const org = await Organization.create({
    name: input.name,
    code: input.code,
    type: input.type,
    status: "Active",
    parentOrgId: input.parentOrgId ?? null,
    tenantId: input.type === "Tenant" ? null : null, // set below for tenant
    email: input.email ?? null,
    phone: null,
    website: null,
    country: input.country ?? null,
    address: null,
  });
  if (input.type === "Tenant") {
    org.tenantId = org.id;
    await org.save();
  }
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: org.id,
    tenantId: org.tenantId,
    action: "org.created",
    entityType: "Organization",
    entityId: org.id,
    sourceIp: ip,
    result: "Success",
  });
  return org;
}

async function transition(
  auth: AuthContext,
  id: string,
  status: "Active" | "Suspended",
  action: string,
  ip: string | null,
): Promise<Organization> {
  const org = await Organization.findByPk(id);
  if (!org) throw new NotFoundError("Organization does not exist", "ORG_NOT_FOUND");
  if (!canActOnOrg(auth, org.id, org.parentOrgId)) throw new ForbiddenError();
  // Distributors cannot activate tenants (PRD restriction) — only SO can activate.
  if (status === "Active" && auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Activation requires Service Owner approval");
  }
  org.status = status;
  await org.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: org.id,
    tenantId: org.tenantId,
    action,
    entityType: "Organization",
    entityId: org.id,
    sourceIp: ip,
    result: "Success",
  });
  return org;
}

export const activateOrganization = (auth: AuthContext, id: string, ip: string | null) =>
  transition(auth, id, "Active", "org.activated", ip);
export const suspendOrganization = (auth: AuthContext, id: string, ip: string | null) =>
  transition(auth, id, "Suspended", "org.suspended", ip);
