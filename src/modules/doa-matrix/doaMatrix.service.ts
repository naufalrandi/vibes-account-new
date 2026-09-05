import { DoaMatrixEntry, DoaMethod, type DoaSourcingMethod } from "../../db/models/doaMatrix.model";
import { PR_ITEM_CATS } from "../../db/seeders/doaMatrix";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

/**
 * OD `doaSeedIfNeeded` seeds `approverKind:'role'`/`'user'` (js/modules.js:4299-4300),
 * and three call sites test for a third kind — `approverKind==='auto'`, the
 * auto-escalation band that walks up the org tiers from the requester
 * (`DOA_AUTO`, js/modules.js:4317-4322; read at :3370, :4323, :4350). The column
 * already carries it; this list rejected it, so an auto band could not be saved.
 */
export const DOA_APPROVER_KINDS = ["role", "user", "auto"] as const;

export interface DoaMatrixView {
  id: string;
  type: string;
  max: number | null;
  currency: string;
  approver: string;
  approverKind: string;
  finance: boolean;
  quotes: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DoaMatrixInput {
  type?: string;
  max?: number | null;
  currency?: string;
  approver?: string;
  approverKind?: string;
  finance?: boolean;
  quotes?: boolean;
}

function view(e: DoaMatrixEntry): DoaMatrixView {
  return {
    id: e.id, type: e.type, max: e.max === null ? null : Number(e.max), currency: e.currency,
    approver: e.approver, approverKind: e.approverKind, finance: e.finance, quotes: e.quotes,
    createdAt: e.createdAt, updatedAt: e.updatedAt,
  };
}

function assertApproverKind(kind: string) {
  if (!DOA_APPROVER_KINDS.includes(kind as (typeof DOA_APPROVER_KINDS)[number])) {
    throw new BadRequestError(`Invalid approverKind "${kind}"`, "INVALID_APPROVER_KIND");
  }
}

export async function listEntries(auth: AuthContext): Promise<DoaMatrixView[]> {
  const rows = await DoaMatrixEntry.findAll({ where: { orgId: auth.orgId }, order: [["createdAt", "DESC"]] });
  return rows.map(view);
}

async function requireEntry(auth: AuthContext, id: string): Promise<DoaMatrixEntry> {
  const e = await DoaMatrixEntry.findOne({ where: { id, orgId: auth.orgId } });
  if (!e) throw new NotFoundError("DOA matrix entry does not exist", "DOA_ENTRY_NOT_FOUND");
  return e;
}

export async function createEntry(auth: AuthContext, input: DoaMatrixInput, ip: string | null): Promise<DoaMatrixView> {
  if (!input.type || !input.type.trim()) throw new BadRequestError("Type is required", "TYPE_REQUIRED");
  if (!input.approver || !input.approver.trim()) throw new BadRequestError("Approver is required", "APPROVER_REQUIRED");
  const approverKind = input.approverKind || "role";
  assertApproverKind(approverKind);
  const e = await DoaMatrixEntry.create({
    orgId: auth.orgId,
    type: input.type.trim(),
    max: input.max ?? null,
    currency: input.currency?.trim() || "IDR",
    approver: input.approver.trim(),
    approverKind: approverKind as (typeof DOA_APPROVER_KINDS)[number],
    finance: input.finance ?? false,
    quotes: input.quotes ?? false,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "doaMatrix.created", entityType: "DoaMatrixEntry", entityId: e.id, sourceIp: ip, result: "Success" });
  return view(e);
}

export async function updateEntry(auth: AuthContext, id: string, input: DoaMatrixInput, ip: string | null): Promise<DoaMatrixView> {
  const e = await requireEntry(auth, id);
  if (input.type !== undefined) {
    if (!input.type.trim()) throw new BadRequestError("Type is required", "TYPE_REQUIRED");
    e.type = input.type.trim();
  }
  if (input.max !== undefined) e.max = input.max;
  if (input.currency !== undefined) e.currency = input.currency.trim() || "IDR";
  if (input.approver !== undefined) {
    if (!input.approver.trim()) throw new BadRequestError("Approver is required", "APPROVER_REQUIRED");
    e.approver = input.approver.trim();
  }
  if (input.approverKind !== undefined) {
    assertApproverKind(input.approverKind);
    e.approverKind = input.approverKind as (typeof DOA_APPROVER_KINDS)[number];
  }
  if (input.finance !== undefined) e.finance = input.finance;
  if (input.quotes !== undefined) e.quotes = input.quotes;
  await e.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "doaMatrix.updated", entityType: "DoaMatrixEntry", entityId: e.id, sourceIp: ip, result: "Success" });
  return view(e);
}

export async function deleteEntry(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const e = await requireEntry(auth, id);
  await e.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "doaMatrix.deleted", entityType: "DoaMatrixEntry", entityId: id, sourceIp: ip, result: "Success" });
}

// ---- Per-category sourcing method (OD `db.doaMethod`) ----------------------

export interface DoaMethodView {
  type: string;
  method: DoaSourcingMethod;
}

/** OD `doaMethodMap` (js/modules.js:4311): 'Order' for Professional Services, 'Direct' otherwise. */
function defaultMethodFor(type: string): DoaSourcingMethod {
  return type === "Professional Services" ? "Order" : "Direct";
}

/**
 * Lazily materialises the map on first read, exactly as `doaMethodMap` does —
 * OD builds it on demand rather than in a seeder.
 */
export async function listMethods(auth: AuthContext): Promise<DoaMethodView[]> {
  const existing = await DoaMethod.count({ where: { orgId: auth.orgId } });
  if (existing === 0) {
    await DoaMethod.bulkCreate(
      PR_ITEM_CATS.map((type) => ({ orgId: auth.orgId, type, method: defaultMethodFor(type) })),
    );
  }
  const rows = await DoaMethod.findAll({ where: { orgId: auth.orgId }, order: [["type", "ASC"]] });
  return rows.map((r) => ({ type: r.type, method: r.method }));
}

export async function setMethod(auth: AuthContext, type: string, method: string, ip: string | null): Promise<DoaMethodView> {
  const t = type.trim();
  if (!t) throw new BadRequestError("Type is required", "TYPE_REQUIRED");
  // OD `doaMethodFor`/`doaSetMethod` (js/modules.js:4312, 4314) coerce anything
  // that is not 'Order' to 'Direct' rather than rejecting it.
  const value: DoaSourcingMethod = method === "Order" ? "Order" : "Direct";
  await listMethods(auth);
  const [row] = await DoaMethod.findOrCreate({ where: { orgId: auth.orgId, type: t }, defaults: { orgId: auth.orgId, type: t, method: value } });
  if (row.method !== value) {
    row.method = value;
    await row.save();
  }
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "doaMethod.updated", entityType: "DoaMethod", entityId: row.id, sourceIp: ip, result: "Success" });
  return { type: row.type, method: row.method };
}
