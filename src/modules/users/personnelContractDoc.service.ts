import { PersonnelContractDocument } from "../../db/models";
import type { ContractDocClause, ContractDocStatus } from "../../db/models/personnelContractComp.models";
import type { AuthContext } from "../../lib/scope";
import { requireManagedUser } from "./user.service";
import { logPersonnelActivity } from "./personnelActivity.service";
import { actorName } from "../record-events/recordEvent.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

export interface ContractDocInput {
  title?: string;
  docType?: string | null;
  status?: ContractDocStatus;
  content?: string | null;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  typeId?: string | null;
  country?: string | null;
  templateId?: string | null;
  clauses?: ContractDocClause[];
}

export async function listContractDocuments(auth: AuthContext, userId: string) {
  const user = await requireManagedUser(auth, userId);
  return (
    await PersonnelContractDocument.findAll({ where: { userId, orgId: user.orgId }, order: [["createdAt", "DESC"]] })
  ).map((r) => r.get({ plain: true }));
}

async function requireDoc(userId: string, orgId: string, id: string): Promise<PersonnelContractDocument> {
  const row = await PersonnelContractDocument.findOne({ where: { id, userId, orgId } });
  if (!row) throw new NotFoundError("Contract document not found", "CONTRACT_DOC_NOT_FOUND");
  return row;
}

export async function createContractDocument(auth: AuthContext, userId: string, input: ContractDocInput) {
  const user = await requireManagedUser(auth, userId);
  if (!input.title || !input.title.trim()) throw new BadRequestError("title is required", "TITLE_REQUIRED");
  const who = await actorName(auth);
  const row = await PersonnelContractDocument.create({
    orgId: user.orgId,
    userId,
    title: input.title.trim(),
    docType: input.docType ?? null,
    status: input.status ?? "Draft",
    content: input.content ?? null,
    effectiveDate: input.effectiveDate ?? null,
    expiryDate: input.expiryDate ?? null,
    typeId: input.typeId ?? null,
    country: input.country ?? null,
    templateId: input.templateId ?? null,
    clauses: input.clauses ?? [],
    createdBy: who,
    lastUpdatedBy: who,
  });
  await logPersonnelActivity(auth, user.orgId, userId, "contract_document.created", row.title);
  return row.get({ plain: true });
}

const STR_FIELDS = ["title", "docType", "content", "effectiveDate", "expiryDate", "typeId", "country", "templateId"] as const;

/** Edits bump `version`; OD's editor treats each save as a new revision of the same document. */
export async function updateContractDocument(auth: AuthContext, userId: string, id: string, input: ContractDocInput) {
  const user = await requireManagedUser(auth, userId);
  const row = await requireDoc(userId, user.orgId, id);
  const rec = row as unknown as Record<string, unknown>;
  for (const k of STR_FIELDS) {
    if (input[k] !== undefined) rec[k] = input[k];
  }
  if (input.clauses !== undefined) row.clauses = input.clauses;
  if (input.title !== undefined && !String(input.title).trim()) throw new BadRequestError("title cannot be cleared", "TITLE_REQUIRED");
  if (input.status !== undefined) row.status = input.status;
  row.version += 1;
  row.lastUpdatedBy = await actorName(auth);
  await row.save();
  await logPersonnelActivity(auth, user.orgId, userId, "contract_document.updated", row.title);
  return row.get({ plain: true });
}

/** OD `Draft` → `Issued` (`modules.js:5251` field contract: `issuedDate` empty until issued). */
export async function issueContractDocument(auth: AuthContext, userId: string, id: string) {
  const user = await requireManagedUser(auth, userId);
  const row = await requireDoc(userId, user.orgId, id);
  row.status = "Issued";
  row.issuedDate = new Date().toISOString().slice(0, 10);
  row.lastUpdatedBy = await actorName(auth);
  await row.save();
  await logPersonnelActivity(auth, user.orgId, userId, "contract_document.issued", row.title);
  return row.get({ plain: true });
}

export async function signContractDocument(auth: AuthContext, userId: string, id: string) {
  const user = await requireManagedUser(auth, userId);
  const row = await requireDoc(userId, user.orgId, id);
  const who = await actorName(auth);
  row.status = "Signed";
  row.signedBy = who;
  row.signedAt = new Date();
  row.lastUpdatedBy = who;
  await row.save();
  await logPersonnelActivity(auth, user.orgId, userId, "contract_document.signed", row.title);
  return row.get({ plain: true });
}
