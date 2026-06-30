import { type WhereOptions } from "sequelize";
import { Organization } from "../../db/models";
import type { OrgBranding, OrgSystemDefaults } from "../../db/models/organization.model";
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
    legalName: null,
    industry: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
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

/**
 * The editable profile of an organization, as surfaced on the Org Settings page.
 * `code` is included for display but is never writable — see updateOrgSettings.
 */
export interface OrgSettings {
  id: string;
  name: string;
  code: string;
  legalName: string | null;
  industry: string | null;
  address: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  // Phase 2 — Org Profile General (identity/contact), Branding, System Defaults.
  taxId: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  branding: OrgBranding | null;
  defaults: OrgSystemDefaults | null;
}

/** Fields a user may change via the Org Settings update. `code` is intentionally absent. */
export interface UpdateOrgSettingsInput {
  name?: string;
  legalName?: string | null;
  industry?: string | null;
  address?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  taxId?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  branding?: OrgBranding | null;
  defaults?: OrgSystemDefaults | null;
}

function toOrgSettings(org: Organization): OrgSettings {
  return {
    id: org.id,
    name: org.name,
    code: org.code,
    legalName: org.legalName,
    industry: org.industry,
    address: org.address,
    contactName: org.contactName,
    contactEmail: org.contactEmail,
    contactPhone: org.contactPhone,
    taxId: org.taxId,
    website: org.website,
    email: org.email,
    phone: org.phone,
    country: org.country,
    branding: org.branding,
    defaults: org.systemDefaults,
  };
}

/** Read the settings of the caller's own organization, scoped by the auth context. */
export async function getOrgSettings(auth: AuthContext): Promise<OrgSettings> {
  const org = await Organization.findByPk(auth.orgId);
  if (!org) throw new NotFoundError("Organization does not exist", "ORG_NOT_FOUND");
  return toOrgSettings(org);
}

/**
 * Partially update the caller's own organization. The target org is always the
 * one from the auth context (`auth.orgId`) — never a client-supplied id — so the
 * organization scope cannot be overridden from the request. `code` is read-only
 * and is never read from input. Only present keys are written (partial update).
 */
export async function updateOrgSettings(
  auth: AuthContext,
  input: UpdateOrgSettingsInput,
  ip: string | null,
): Promise<OrgSettings> {
  const org = await Organization.findByPk(auth.orgId);
  if (!org) throw new NotFoundError("Organization does not exist", "ORG_NOT_FOUND");

  if (input.name !== undefined) org.name = input.name;
  if (input.legalName !== undefined) org.legalName = input.legalName;
  if (input.industry !== undefined) org.industry = input.industry;
  if (input.address !== undefined) org.address = input.address;
  if (input.contactName !== undefined) org.contactName = input.contactName;
  if (input.contactEmail !== undefined) org.contactEmail = input.contactEmail;
  if (input.contactPhone !== undefined) org.contactPhone = input.contactPhone;
  if (input.taxId !== undefined) org.taxId = input.taxId;
  if (input.website !== undefined) org.website = input.website;
  if (input.email !== undefined) org.email = input.email;
  if (input.phone !== undefined) org.phone = input.phone;
  if (input.country !== undefined) org.country = input.country;
  if (input.branding !== undefined) org.branding = input.branding;
  if (input.defaults !== undefined) org.systemDefaults = input.defaults;

  await org.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: org.id,
    tenantId: org.tenantId,
    action: "org.settings.updated",
    entityType: "Organization",
    entityId: org.id,
    sourceIp: ip,
    result: "Success",
  });
  return toOrgSettings(org);
}
