import { type WhereOptions } from "sequelize";
import { AgreementTemplate } from "../../db/models";
import type { AgreementBlock, AgreementTemplateStatus } from "../../db/models/agreementTemplate.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { ConflictError, NotFoundError } from "../../lib/errors";

export interface CreateTemplateInput {
  name: string;
  description?: string | null;
  version?: string;
  status?: AgreementTemplateStatus;
  blocks?: AgreementBlock[];
}

export type UpdateTemplateInput = Partial<CreateTemplateInput>;

/** Substitute `{{key}}` tokens in every block's text with the given variable values. */
export function renderBlocks(blocks: AgreementBlock[], vars: Record<string, string>): AgreementBlock[] {
  return blocks.map((b) => ({
    ...b,
    text: b.text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key: string) =>
      key in vars ? vars[key] : m,
    ),
  }));
}

/** Next `AGT-####` code, starting at 1001 (max existing numeric suffix + 1). */
async function nextTemplateCode(): Promise<string> {
  const rows = await AgreementTemplate.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^AGT-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `AGT-${max + 1}`;
}

export async function listTemplates(
  auth: AuthContext,
  status?: AgreementTemplateStatus,
): Promise<AgreementTemplate[]> {
  const where: WhereOptions = { orgId: auth.orgId };
  if (status) Object.assign(where, { status });
  return AgreementTemplate.findAll({ where, order: [["createdAt", "DESC"]] });
}

async function requireOwned(auth: AuthContext, id: string): Promise<AgreementTemplate> {
  const t = await AgreementTemplate.findOne({ where: { id, orgId: auth.orgId } });
  if (!t) throw new NotFoundError("Agreement template does not exist", "TEMPLATE_NOT_FOUND");
  return t;
}

export async function getTemplate(auth: AuthContext, id: string): Promise<AgreementTemplate> {
  return requireOwned(auth, id);
}

export async function createTemplate(
  auth: AuthContext,
  input: CreateTemplateInput,
  ip: string | null,
): Promise<AgreementTemplate> {
  const t = await AgreementTemplate.create({
    orgId: auth.orgId,
    code: await nextTemplateCode(),
    name: input.name,
    description: input.description ?? null,
    version: input.version ?? "v1.0",
    status: input.status ?? "Draft",
    blocks: input.blocks ?? [],
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "agreement.template.created",
    entityType: "AgreementTemplate",
    entityId: t.id,
    sourceIp: ip,
    result: "Success",
  });
  return t;
}

export async function updateTemplate(
  auth: AuthContext,
  id: string,
  input: UpdateTemplateInput,
  ip: string | null,
): Promise<AgreementTemplate> {
  const t = await requireOwned(auth, id);
  // Archived templates are read-only (legacy: editor disabled when Archived).
  if (t.status === "Archived" && !(input.status && input.status !== "Archived")) {
    throw new ConflictError("Archived templates cannot be edited", "TEMPLATE_ARCHIVED");
  }
  if (input.name !== undefined) t.name = input.name;
  if (input.description !== undefined) t.description = input.description ?? null;
  if (input.version !== undefined) t.version = input.version;
  if (input.status !== undefined) t.status = input.status;
  if (input.blocks !== undefined) t.blocks = input.blocks;
  await t.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "agreement.template.updated",
    entityType: "AgreementTemplate",
    entityId: t.id,
    sourceIp: ip,
    result: "Success",
  });
  return t;
}

/** Duplicate a template into a fresh Draft (legacy: Duplicate → Draft). */
export async function duplicateTemplate(
  auth: AuthContext,
  id: string,
  ip: string | null,
): Promise<AgreementTemplate> {
  const src = await requireOwned(auth, id);
  const copy = await AgreementTemplate.create({
    orgId: auth.orgId,
    code: await nextTemplateCode(),
    name: `${src.name} (Copy)`,
    description: src.description,
    version: src.version,
    status: "Draft",
    blocks: src.blocks,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "agreement.template.duplicated",
    entityType: "AgreementTemplate",
    entityId: copy.id,
    sourceIp: ip,
    result: "Success",
    metadata: { sourceId: src.id },
  });
  return copy;
}

export async function deleteTemplate(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const t = await requireOwned(auth, id);
  await t.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "agreement.template.deleted",
    entityType: "AgreementTemplate",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
