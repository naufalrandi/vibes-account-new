import { Op, type WhereOptions } from "sequelize";
import { Document, DocumentFolder } from "../../db/models";
import type { DocumentBlock, DocumentKind, DocumentStatus, DocumentFolderStatus } from "../../db/models/document.model";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

export interface FolderInput {
  name: string;
  description?: string | null;
  status?: DocumentFolderStatus;
}

export interface DocumentInput {
  kind: DocumentKind;
  title: string;
  docType?: string | null;
  status?: DocumentStatus;
  version?: string;
  content?: DocumentBlock[] | null;
  folderId?: string | null;
  issuer?: string | null;
  link?: string | null;
  effectiveDate?: string | null;
  nextReview?: string | null;
  owner?: string | null;
  notes?: string | null;
}

/** Org visibility for the calling actor: SO/unrestricted → null, else its own + visible tenant org ids. */
async function orgWhere(auth: AuthContext): Promise<WhereOptions> {
  const ids = await visibleTenantOrgIds(auth);
  return ids === null ? {} : { orgId: { [Op.in]: ids } };
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

async function audit(auth: AuthContext, action: string, entityType: string, id: string, ip: string | null): Promise<void> {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId: id, sourceIp: ip, result: "Success" });
}

// --- Folders --------------------------------------------------------------

export async function listFolders(auth: AuthContext): Promise<DocumentFolder[]> {
  const where = await orgWhere(auth);
  return DocumentFolder.findAll({ where, order: [["name", "ASC"]] });
}

async function requireFolder(auth: AuthContext, id: string): Promise<DocumentFolder> {
  const f = await DocumentFolder.findByPk(id);
  if (!f) throw new NotFoundError("Folder does not exist", "FOLDER_NOT_FOUND");
  await assertCanSeeOrg(auth, f.orgId);
  return f;
}

export async function createFolder(auth: AuthContext, input: FolderInput, ip: string | null): Promise<DocumentFolder> {
  if (!input.name || !input.name.trim()) throw new BadRequestError("Name is required", "NAME_REQUIRED");
  const f = await DocumentFolder.create({
    orgId: auth.orgId,
    name: input.name.trim(),
    description: input.description ?? null,
    status: input.status ?? "Active",
    createdBy: auth.userId,
  });
  await audit(auth, "document.folder.created", "DocumentFolder", f.id, ip);
  return f;
}

export async function updateFolder(auth: AuthContext, id: string, input: Partial<FolderInput>, ip: string | null): Promise<DocumentFolder> {
  const f = await requireFolder(auth, id);
  if (input.name !== undefined) f.name = input.name.trim();
  if (input.description !== undefined) f.description = input.description;
  if (input.status !== undefined) f.status = input.status;
  await f.save();
  await audit(auth, "document.folder.updated", "DocumentFolder", f.id, ip);
  return f;
}

export async function deleteFolder(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const f = await requireFolder(auth, id);
  await f.destroy();
  await audit(auth, "document.folder.deleted", "DocumentFolder", id, ip);
}

// --- Documents --------------------------------------------------------------

export async function listDocuments(
  auth: AuthContext,
  filters: { kind?: DocumentKind; folderId?: string; status?: DocumentStatus; search?: string } = {},
): Promise<Document[]> {
  const where: WhereOptions = { ...(await orgWhere(auth)) };
  if (filters.kind) Object.assign(where, { kind: filters.kind });
  if (filters.folderId) Object.assign(where, { folderId: filters.folderId });
  if (filters.status) Object.assign(where, { status: filters.status });
  if (filters.search) Object.assign(where, { title: { [Op.iLike]: `%${filters.search}%` } });
  return Document.findAll({ where, order: [["createdAt", "DESC"]] });
}

async function requireDocument(auth: AuthContext, id: string): Promise<Document> {
  const d = await Document.findByPk(id);
  if (!d) throw new NotFoundError("Document does not exist", "DOCUMENT_NOT_FOUND");
  await assertCanSeeOrg(auth, d.orgId);
  return d;
}

export async function getDocument(auth: AuthContext, id: string): Promise<Document> {
  return requireDocument(auth, id);
}

export async function createDocument(auth: AuthContext, input: DocumentInput, ip: string | null): Promise<Document> {
  if (!input.title || !input.title.trim()) throw new BadRequestError("Title is required", "TITLE_REQUIRED");
  if (input.kind !== "internal" && input.kind !== "external") throw new BadRequestError("A valid kind is required", "KIND_REQUIRED");
  if (input.folderId) await requireFolder(auth, input.folderId); // folder must exist and be in-scope
  const d = await Document.create({
    orgId: auth.orgId,
    kind: input.kind,
    title: input.title.trim(),
    docType: input.docType ?? null,
    status: input.status ?? "Draft",
    version: input.version ?? "0.1",
    content: input.kind === "internal" ? (input.content ?? []) : null,
    folderId: input.kind === "external" ? (input.folderId ?? null) : null,
    issuer: input.issuer ?? null,
    link: input.link ?? null,
    effectiveDate: input.effectiveDate ?? null,
    nextReview: input.nextReview ?? null,
    owner: input.owner ?? null,
    notes: input.notes ?? null,
    createdBy: auth.userId,
  });
  await audit(auth, "document.created", "Document", d.id, ip);
  return d;
}

export async function updateDocument(auth: AuthContext, id: string, input: Partial<DocumentInput>, ip: string | null): Promise<Document> {
  const d = await requireDocument(auth, id);
  if (input.title !== undefined) d.title = input.title.trim();
  if (input.docType !== undefined) d.docType = input.docType;
  if (input.version !== undefined) d.version = input.version;
  if (input.content !== undefined) d.content = input.content;
  if (input.folderId !== undefined) {
    if (input.folderId) await requireFolder(auth, input.folderId);
    d.folderId = input.folderId;
  }
  if (input.issuer !== undefined) d.issuer = input.issuer;
  if (input.link !== undefined) d.link = input.link;
  if (input.effectiveDate !== undefined) d.effectiveDate = input.effectiveDate;
  if (input.nextReview !== undefined) d.nextReview = input.nextReview;
  if (input.owner !== undefined) d.owner = input.owner;
  if (input.notes !== undefined) d.notes = input.notes;
  if (input.status !== undefined) d.status = input.status;
  await d.save();
  await audit(auth, "document.updated", "Document", d.id, ip);
  return d;
}

export async function setStatus(auth: AuthContext, id: string, status: DocumentStatus, ip: string | null): Promise<Document> {
  const d = await requireDocument(auth, id);
  d.status = status;
  await d.save();
  await audit(auth, `document.${status.toLowerCase()}`, "Document", d.id, ip);
  return d;
}

export const publish = (auth: AuthContext, id: string, ip: string | null): Promise<Document> => setStatus(auth, id, "Published", ip);
export const archive = (auth: AuthContext, id: string, ip: string | null): Promise<Document> => setStatus(auth, id, "Archived", ip);

export async function deleteDocument(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const d = await requireDocument(auth, id);
  await d.destroy();
  await audit(auth, "document.deleted", "Document", id, ip);
}
