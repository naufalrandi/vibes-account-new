import { OrgSignatory } from "../../db/models";
import type { SignatoryStatus } from "../../db/models/orgSignatory.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { NotFoundError } from "../../lib/errors";

export interface CreateSignatoryInput {
  fullName: string;
  title: string;
  email: string;
  signatureImage?: string | null;
  status?: SignatoryStatus;
}

export type UpdateSignatoryInput = Partial<CreateSignatoryInput>;

/** List the caller's own org signatories (org always from the auth context). */
export async function listSignatories(auth: AuthContext): Promise<OrgSignatory[]> {
  return OrgSignatory.findAll({ where: { orgId: auth.orgId }, order: [["createdAt", "DESC"]] });
}

/** Resolve a signatory owned by the actor's org, or 404. */
async function requireOwned(auth: AuthContext, id: string): Promise<OrgSignatory> {
  const sig = await OrgSignatory.findOne({ where: { id, orgId: auth.orgId } });
  if (!sig) throw new NotFoundError("Signatory does not exist", "SIGNATORY_NOT_FOUND");
  return sig;
}

export async function createSignatory(
  auth: AuthContext,
  input: CreateSignatoryInput,
  ip: string | null,
): Promise<OrgSignatory> {
  const sig = await OrgSignatory.create({
    orgId: auth.orgId,
    fullName: input.fullName,
    title: input.title,
    email: input.email,
    signatureImage: input.signatureImage ?? null,
    status: input.status ?? "Active",
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "signatory.created",
    entityType: "OrgSignatory",
    entityId: sig.id,
    sourceIp: ip,
    result: "Success",
  });
  return sig;
}

export async function updateSignatory(
  auth: AuthContext,
  id: string,
  input: UpdateSignatoryInput,
  ip: string | null,
): Promise<OrgSignatory> {
  const sig = await requireOwned(auth, id);
  if (input.fullName !== undefined) sig.fullName = input.fullName;
  if (input.title !== undefined) sig.title = input.title;
  if (input.email !== undefined) sig.email = input.email;
  if (input.signatureImage !== undefined) sig.signatureImage = input.signatureImage ?? null;
  if (input.status !== undefined) sig.status = input.status;
  await sig.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "signatory.updated",
    entityType: "OrgSignatory",
    entityId: sig.id,
    sourceIp: ip,
    result: "Success",
  });
  return sig;
}

/** Flip Active ↔ Inactive (matches the legacy per-row Activate/Deactivate). */
export async function toggleSignatory(
  auth: AuthContext,
  id: string,
  ip: string | null,
): Promise<OrgSignatory> {
  const sig = await requireOwned(auth, id);
  sig.status = sig.status === "Active" ? "Inactive" : "Active";
  await sig.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "signatory.toggled",
    entityType: "OrgSignatory",
    entityId: sig.id,
    sourceIp: ip,
    result: "Success",
  });
  return sig;
}

export async function deleteSignatory(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const sig = await requireOwned(auth, id);
  await sig.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "signatory.deleted",
    entityType: "OrgSignatory",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
