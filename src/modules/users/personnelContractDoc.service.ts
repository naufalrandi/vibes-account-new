import { PersonnelContractDocument } from "../../db/models";
import type { ContractDocClause, ContractDocStatus } from "../../db/models/personnelContractComp.models";
import type { AuthContext } from "../../lib/scope";
import { requireManagedUser } from "./user.service";
import { logPersonnelActivity } from "./personnelActivity.service";
import { actorName } from "../record-events/recordEvent.service";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors";
import { orgToday } from "../../lib/localDate";

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

/**
 * Contract document lifecycle: Draft -> Issued (`issue`, may repeat to re-issue
 * a revised Issued document) -> Signed (`sign`, only from Issued). Status only
 * moves through those two actions, and a Signed document is final: no edits,
 * no re-issue.
 */
function assertNotSigned(row: PersonnelContractDocument): void {
  if (row.status === "Signed") {
    throw new ConflictError("A signed contract document can no longer be changed", "CONTRACT_DOC_SIGNED");
  }
}

export async function createContractDocument(auth: AuthContext, userId: string, input: ContractDocInput) {
  const user = await requireManagedUser(auth, userId);
  if (!input.title || !input.title.trim()) throw new BadRequestError("title is required", "TITLE_REQUIRED");
  if (input.status !== undefined && input.status !== "Draft") {
    throw new BadRequestError("A contract document starts as Draft; issue and sign it through their actions", "INVALID_STATUS");
  }
  const who = await actorName(auth);
  const row = await PersonnelContractDocument.create({
    orgId: user.orgId,
    userId,
    title: input.title.trim(),
    docType: input.docType ?? null,
    status: "Draft",
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

/** Edits do not bump `version`; OD's `cdCapture` (js/modules.js:5262) just saves the clause in place. */
export async function updateContractDocument(auth: AuthContext, userId: string, id: string, input: ContractDocInput) {
  const user = await requireManagedUser(auth, userId);
  const row = await requireDoc(userId, user.orgId, id);
  assertNotSigned(row);
  if (input.status !== undefined && input.status !== row.status) {
    throw new ConflictError("Change a contract document's status with the issue / sign actions", "USE_CONTRACT_DOC_ACTION");
  }
  const rec = row as unknown as Record<string, unknown>;
  for (const k of STR_FIELDS) {
    if (input[k] !== undefined) rec[k] = input[k];
  }
  if (input.clauses !== undefined) row.clauses = input.clauses;
  if (input.title !== undefined && !String(input.title).trim()) throw new BadRequestError("title cannot be cleared", "TITLE_REQUIRED");
  row.lastUpdatedBy = await actorName(auth);
  await row.save();
  await logPersonnelActivity(auth, user.orgId, userId, "contract_document.updated", row.title);
  return row.get({ plain: true });
}

/** OD `cdIssue` (js/modules.js:5390): `Draft` → `Issued`, and the only step that bumps `version`. */
export async function issueContractDocument(auth: AuthContext, userId: string, id: string) {
  const user = await requireManagedUser(auth, userId);
  const row = await requireDoc(userId, user.orgId, id);
  assertNotSigned(row);
  row.status = "Issued";
  row.version += 1;
  row.issuedDate = await orgToday(user.orgId);
  row.lastUpdatedBy = await actorName(auth);
  await row.save();
  await logPersonnelActivity(auth, user.orgId, userId, "contract_document.issued", row.title);
  return row.get({ plain: true });
}

export async function signContractDocument(auth: AuthContext, userId: string, id: string) {
  const user = await requireManagedUser(auth, userId);
  const row = await requireDoc(userId, user.orgId, id);
  if (row.status !== "Issued") {
    throw new ConflictError("Only an issued contract document can be signed", "CONTRACT_DOC_NOT_ISSUED");
  }
  const who = await actorName(auth);
  row.status = "Signed";
  row.signedBy = who;
  row.signedAt = new Date();
  row.lastUpdatedBy = who;
  await row.save();
  await logPersonnelActivity(auth, user.orgId, userId, "contract_document.signed", row.title);
  return row.get({ plain: true });
}
