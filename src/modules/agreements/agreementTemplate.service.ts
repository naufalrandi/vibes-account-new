import { AgreementTemplate } from "../../db/models";
import type { AgreementBlock, AgreementTemplateStatus } from "../../db/models/agreementTemplate.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreateAgreementInput {
  name: string;
  description?: string | null;
  version?: string;
  status?: AgreementTemplateStatus;
  blocks?: AgreementBlock[];
}

export type UpdateAgreementInput = Partial<CreateAgreementInput>;

export interface ListAgreementFilters {
  status?: AgreementTemplateStatus;
}

/** Agreement templates are platform-global master data — Service Owner only. */
function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage partnership agreements");
  }
}

let blockSeq = 0;
function blockId(): string {
  blockSeq += 1;
  return `blk_${Date.now().toString(36)}_${blockSeq}`;
}

/** A minimal starter document so a new template opens with usable structure. */
function defaultBlocks(): AgreementBlock[] {
  return [
    { id: blockId(), type: "heading", text: "PARTNERSHIP AGREEMENT" },
    {
      id: blockId(),
      type: "paragraph",
      text: "This Partnership Agreement is made on {{agreement_date}} between {{service_provider_name}} and {{partner_name}} ({{partner_code}}).",
    },
    { id: blockId(), type: "heading", text: "1. Commercial Terms" },
    {
      id: blockId(),
      type: "paragraph",
      text: "Revenue share is {{revenue_share_percentage}}% with a partner discount of {{partner_discount_percentage}}%. All amounts are in {{currency}}.",
    },
    { id: blockId(), type: "heading", text: "2. Term and Termination" },
    {
      id: blockId(),
      type: "paragraph",
      text: "This agreement is effective {{effective_date}} for {{agreement_duration_months}} months and may be terminated with {{termination_notice_days}} days notice.",
    },
    { id: blockId(), type: "signature", text: "Signed for and on behalf of the parties." },
  ];
}

async function nextCode(): Promise<string> {
  const rows = await AgreementTemplate.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = parseInt((r.code || "").replace(/\D/g, ""), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `AGT-${max + 1}`;
}

export async function listAgreements(
  auth: AuthContext,
  filters: ListAgreementFilters = {},
): Promise<AgreementTemplate[]> {
  assertServiceOwner(auth);
  const where = filters.status ? { status: filters.status } : undefined;
  return AgreementTemplate.findAll({ where, order: [["name", "ASC"]] });
}

export async function getAgreement(auth: AuthContext, id: string): Promise<AgreementTemplate> {
  assertServiceOwner(auth);
  const tpl = await AgreementTemplate.findByPk(id);
  if (!tpl) throw new NotFoundError("Agreement template does not exist", "AGREEMENT_NOT_FOUND");
  return tpl;
}

export async function createAgreement(
  auth: AuthContext,
  input: CreateAgreementInput,
  ip: string | null,
): Promise<AgreementTemplate> {
  assertServiceOwner(auth);
  const tpl = await AgreementTemplate.create({
    code: await nextCode(),
    name: input.name,
    description: input.description ?? null,
    version: input.version ?? "v1.0",
    status: input.status ?? "Draft",
    blocks: input.blocks && input.blocks.length ? input.blocks : defaultBlocks(),
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "agreement.created",
    entityType: "AgreementTemplate",
    entityId: tpl.id,
    sourceIp: ip,
    result: "Success",
  });
  return tpl;
}

export async function updateAgreement(
  auth: AuthContext,
  id: string,
  input: UpdateAgreementInput,
  ip: string | null,
): Promise<AgreementTemplate> {
  assertServiceOwner(auth);
  const tpl = await AgreementTemplate.findByPk(id);
  if (!tpl) throw new NotFoundError("Agreement template does not exist", "AGREEMENT_NOT_FOUND");

  if (input.name !== undefined) tpl.name = input.name;
  if (input.description !== undefined) tpl.description = input.description ?? null;
  if (input.version !== undefined) tpl.version = input.version;
  if (input.status !== undefined) tpl.status = input.status;
  if (input.blocks !== undefined) tpl.blocks = input.blocks;
  await tpl.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "agreement.updated",
    entityType: "AgreementTemplate",
    entityId: tpl.id,
    sourceIp: ip,
    result: "Success",
  });
  return tpl;
}

export async function duplicateAgreement(
  auth: AuthContext,
  id: string,
  ip: string | null,
): Promise<AgreementTemplate> {
  assertServiceOwner(auth);
  const source = await AgreementTemplate.findByPk(id);
  if (!source) throw new NotFoundError("Agreement template does not exist", "AGREEMENT_NOT_FOUND");

  const copy = await AgreementTemplate.create({
    code: await nextCode(),
    name: `${source.name} (Copy)`,
    description: source.description,
    version: source.version,
    status: "Draft",
    blocks: source.blocks.map((b) => ({ ...b, id: blockId() })),
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "agreement.duplicated",
    entityType: "AgreementTemplate",
    entityId: copy.id,
    sourceIp: ip,
    result: "Success",
    metadata: { sourceId: id },
  });
  return copy;
}

export async function deleteAgreement(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const tpl = await AgreementTemplate.findByPk(id);
  if (!tpl) throw new NotFoundError("Agreement template does not exist", "AGREEMENT_NOT_FOUND");
  if (tpl.status === "Active") {
    throw new ConflictError("Archive the agreement before deleting it", "AGREEMENT_ACTIVE");
  }
  await tpl.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "agreement.deleted",
    entityType: "AgreementTemplate",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
