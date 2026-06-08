import { randomUUID } from "node:crypto";
import { Op, type WhereOptions, type Transaction } from "sequelize";
import { sequelize } from "../../db/sequelize";
import { Organization, User, PartnerAgreement } from "../../db/models";
import type { PartnerStatus, PartnerTier, PartnerAuditEntry } from "../../db/models/organization.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { sendActivationInvite } from "../notifications/notification.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

/** A partner is a Distributor organization with commercial lifecycle metadata. */
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
  audit: PartnerAuditEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ListPartnerFilters {
  status?: string;
  country?: string;
  search?: string;
}

/** Partners are platform-global master data — only the Service Owner manages them. */
export function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage partners");
  }
}

function toView(org: Organization, tenantCount: number): PartnerView {
  return {
    id: org.id,
    code: org.partnerCode ?? null,
    name: org.name,
    email: org.email,
    phone: org.phone,
    website: org.website,
    country: org.country,
    address: org.address,
    status: (org.partnerStatus ?? "Draft") as PartnerStatus,
    tier: (org.partnerTier ?? null) as PartnerTier | null,
    tenantCount,
    audit: org.partnerAudit ?? [],
    createdAt: org.createdAt.toISOString(),
    updatedAt: org.updatedAt.toISOString(),
  };
}

/** Count Tenant orgs per partner (parentOrgId) for the list/detail "Tenants" metric. */
async function tenantCountsByPartner(partnerIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (partnerIds.length === 0) return counts;
  const tenants = await Organization.findAll({
    where: { type: "Tenant", parentOrgId: { [Op.in]: partnerIds } },
    attributes: ["parentOrgId"],
  });
  for (const t of tenants) {
    const key = t.parentOrgId as string;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export async function listPartners(auth: AuthContext, filters: ListPartnerFilters = {}): Promise<PartnerView[]> {
  assertServiceOwner(auth);
  const and: WhereOptions[] = [{ type: "Distributor" }];
  if (filters.status) and.push({ partnerStatus: filters.status });
  if (filters.country) and.push({ country: filters.country });
  if (filters.search) {
    const term = `%${filters.search}%`;
    and.push({
      [Op.or]: [
        { name: { [Op.iLike]: term } },
        { partnerCode: { [Op.iLike]: term } },
        { email: { [Op.iLike]: term } },
      ],
    });
  }
  const rows = await Organization.findAll({ where: { [Op.and]: and }, order: [["createdAt", "DESC"]] });
  const counts = await tenantCountsByPartner(rows.map((r) => r.id));
  return rows.map((r) => toView(r, counts.get(r.id) ?? 0));
}

/** Resolve a partner (Distributor org) owned by the platform, or 404. */
export async function requirePartner(id: string): Promise<Organization> {
  const org = await Organization.findOne({ where: { id, type: "Distributor" } });
  if (!org) throw new NotFoundError("Partner does not exist", "PARTNER_NOT_FOUND");
  return org;
}

export async function getPartner(auth: AuthContext, id: string): Promise<PartnerView> {
  assertServiceOwner(auth);
  const org = await requirePartner(id);
  const counts = await tenantCountsByPartner([org.id]);
  return toView(org, counts.get(org.id) ?? 0);
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
}

export type UpdatePartnerInput = Partial<Omit<CreatePartnerInput, "admin">>;

/** Next partner code PRT-#### from existing partner codes. */
async function nextPartnerCode(tx?: Transaction): Promise<string> {
  const rows = await Organization.findAll({ where: { type: "Distributor" }, attributes: ["partnerCode"], transaction: tx });
  let max = 1000;
  for (const r of rows) {
    const code = r.partnerCode;
    if (code?.startsWith("PRT-")) {
      const n = parseInt(code.slice(4), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return `PRT-${max + 1}`;
}

function pushAudit(org: Organization, msg: string): void {
  org.partnerAudit = [{ ts: new Date().toISOString(), msg }, ...(org.partnerAudit ?? [])];
}

/**
 * Create a partner: a Distributor org (Draft) + its Partner Administrator user
 * (PendingActivation + activation invite), in one transaction. Agreement
 * generation (Generate & Send mode) is orchestrated by the controller afterwards.
 */
export async function createPartner(auth: AuthContext, input: CreatePartnerInput, ip: string | null): Promise<Organization> {
  assertServiceOwner(auth);
  const dupUser = await User.findOne({
    where: { [Op.or]: [{ username: input.admin.username }, { email: input.admin.email }] },
  });
  if (dupUser) throw new ConflictError("Admin username or email already exists", "DUPLICATE_USER");

  // Derive the partner code + create org/admin/audit atomically. The activation
  // email is sent only AFTER the transaction commits, so a rollback never emails.
  const { partner, adminEmail, activationToken } = await sequelize.transaction(async (tx) => {
    const partnerCode = await nextPartnerCode(tx);
    const org = await Organization.create(
      {
        name: input.name, code: partnerCode, type: "Distributor", status: "Active",
        parentOrgId: auth.orgId, tenantId: null,
        email: input.email ?? null, phone: input.phone ?? null, website: input.website ?? null,
        country: input.country ?? null, address: input.address ?? null,
        partnerStatus: "Draft", partnerTier: input.tier ?? "Bronze", partnerCode,
        partnerAudit: [{ ts: new Date().toISOString(), msg: "Partner organization created" }],
      },
      { transaction: tx },
    );
    const token = randomUUID();
    const admin = await User.create(
      {
        orgId: org.id, tenantId: null, fullName: input.admin.fullName, username: input.admin.username,
        email: input.admin.email, passwordHash: null, status: "PendingActivation", position: "Administrator",
        workUnit: null, lastLogin: null, activationToken: token, resetToken: null, resetExpires: null,
      },
      { transaction: tx },
    );
    await writeAudit(
      { actorUserId: auth.userId, organizationId: org.id, tenantId: null, action: "partner.created", entityType: "Organization", entityId: org.id, sourceIp: ip, result: "Success" },
      tx,
    );
    return { partner: org, adminEmail: admin.email, activationToken: token };
  });
  sendActivationInvite(adminEmail, activationToken);
  return partner;
}

export async function updatePartner(auth: AuthContext, id: string, input: UpdatePartnerInput, ip: string | null): Promise<PartnerView> {
  assertServiceOwner(auth);
  const partner = await requirePartner(id);
  if (input.name !== undefined) partner.name = input.name;
  if (input.email !== undefined) partner.email = input.email;
  if (input.phone !== undefined) partner.phone = input.phone;
  if (input.website !== undefined) partner.website = input.website;
  if (input.country !== undefined) partner.country = input.country;
  if (input.address !== undefined) partner.address = input.address;
  if (input.tier !== undefined) partner.partnerTier = input.tier;
  await partner.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: id, tenantId: null, action: "partner.updated", entityType: "Organization", entityId: id, sourceIp: ip, result: "Success" });
  const counts = await tenantCountsByPartner([id]);
  return toView(partner, counts.get(id) ?? 0);
}

/**
 * Shared lifecycle transition. Loads the partner ONCE, enforces the allowed
 * source states, then moves status + (for Terminated) the agreement + audit in a
 * single transaction so the coupled partner/agreement state can't diverge.
 */
async function transition(
  auth: AuthContext,
  id: string,
  to: PartnerStatus,
  msg: string,
  action: string,
  from: PartnerStatus[],
  ip: string | null,
): Promise<PartnerView> {
  assertServiceOwner(auth);
  const partner = await requirePartner(id);
  const current = (partner.partnerStatus ?? "Draft") as PartnerStatus;
  if (!from.includes(current)) {
    throw new BadRequestError(`Cannot ${action.split(".")[1]} a partner in status "${current}"`, "INVALID_PARTNER_STATE");
  }
  await sequelize.transaction(async (tx) => {
    partner.partnerStatus = to;
    pushAudit(partner, msg);
    await partner.save({ transaction: tx });
    if (to === "Terminated") {
      const pa = await PartnerAgreement.findOne({ where: { orgId: id }, transaction: tx });
      if (pa && pa.status !== "Terminated") {
        pa.status = "Terminated";
        pa.history = [...pa.history, { date: new Date().toISOString().slice(0, 10), event: "Agreement Terminated" }];
        await pa.save({ transaction: tx });
      }
    }
    await writeAudit(
      { actorUserId: auth.userId, organizationId: id, tenantId: null, action, entityType: "Organization", entityId: id, sourceIp: ip, result: "Success" },
      tx,
    );
  });
  const counts = await tenantCountsByPartner([id]);
  return toView(partner, counts.get(id) ?? 0);
}

export const activatePartner = (auth: AuthContext, id: string, ip: string | null) =>
  transition(auth, id, "Active", "Partner activated", "partner.activated", ["Approved"], ip);
export const suspendPartner = (auth: AuthContext, id: string, ip: string | null) =>
  transition(auth, id, "Suspended", "Partner suspended", "partner.suspended", ["Active"], ip);
export const resumePartner = (auth: AuthContext, id: string, ip: string | null) =>
  transition(auth, id, "Active", "Partner resumed", "partner.resumed", ["Suspended"], ip);
export const terminatePartner = (auth: AuthContext, id: string, ip: string | null) =>
  transition(auth, id, "Terminated", "Partnership terminated", "partner.terminated", ["Draft", "Pending Approval", "Approved", "Active", "Suspended"], ip);
