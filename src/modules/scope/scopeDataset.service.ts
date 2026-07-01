import { Op } from "sequelize";
import { ScopeDataset } from "../../db/models";
import { SCOPE_DATASET_KINDS, scopeDatasetSeed } from "./scopeDatasets.data";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v == null || v === "" ? null : String(v));

/** Ensure the SP-global master pick-lists exist (idempotent; survives resets). */
export async function ensureGlobalSeed(): Promise<void> {
  const n = await ScopeDataset.count({ where: { orgId: null } });
  if (n > 0) return;
  await ScopeDataset.bulkCreate(scopeDatasetSeed().map((r) => ({ ...r, orgId: null })));
}

async function audit(auth: AuthContext, action: string, id: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType: "ScopeDataset", entityId: id, sourceIp: ip, result: "Success" });
}

/** SP-global (org_id NULL) rows are visible to everyone; tenant rows to their owner. */
export async function listDatasets(auth: AuthContext, kind?: string) {
  if (kind && !SCOPE_DATASET_KINDS.includes(kind as never)) throw new BadRequestError("Unknown dataset kind", "INVALID_KIND");
  await ensureGlobalSeed();
  const ids = await visibleTenantOrgIds(auth);
  const orgClause = ids === null ? {} : { [Op.or]: [{ orgId: null }, { orgId: { [Op.in]: ids } }] };
  const where = kind ? { ...orgClause, kind } : orgClause;
  return (await ScopeDataset.findAll({ where, order: [["kind", "ASC"], ["name", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createDataset(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const kind = str(input.kind);
  const name = str(input.name);
  if (!kind || !SCOPE_DATASET_KINDS.includes(kind as never)) throw new BadRequestError("Valid kind (env/ptype/dep) is required", "INVALID_KIND");
  if (!name) throw new BadRequestError("Name is required", "NAME_REQUIRED");
  const isSp = auth.orgType === "ServiceOwner";
  const row = await ScopeDataset.create({
    orgId: isSp ? null : auth.orgId, kind, name, category: str(input.category), description: str(input.description), status: str(input.status) || "Active",
  });
  await audit(auth, "scope.dataset.created", row.id, ip);
  return row.get({ plain: true });
}
async function requireOwned(auth: AuthContext, id: string): Promise<ScopeDataset> {
  const row = await ScopeDataset.findByPk(id);
  if (!row) throw new NotFoundError("Dataset not found", "DATASET_NOT_FOUND");
  const ownGlobal = row.orgId === null && auth.orgType === "ServiceOwner";
  if (!ownGlobal && row.orgId !== auth.orgId) throw new ForbiddenError();
  return row;
}
export async function updateDataset(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await requireOwned(auth, id);
  if (input.name !== undefined) row.name = str(input.name) ?? row.name;
  if (input.category !== undefined) row.category = str(input.category);
  if (input.description !== undefined) row.description = str(input.description);
  if (input.status !== undefined) { const s = str(input.status); if (s === "Active" || s === "Inactive") row.status = s; }
  await row.save();
  await audit(auth, "scope.dataset.updated", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteDataset(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireOwned(auth, id);
  await row.destroy();
  await audit(auth, "scope.dataset.deleted", id, ip);
}
