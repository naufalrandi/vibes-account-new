import type { Transaction } from "sequelize";
import { AuditLog } from "../../db/models";

export interface AuditEntry {
  actorUserId?: string | null;
  organizationId?: string | null;
  tenantId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  sourceIp?: string | null;
  result: "Success" | "Failure";
  metadata?: Record<string, unknown> | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeUuid = (v?: string | null): string | null => (v && UUID_RE.test(v) ? v : null);

/** Append-only. No update/delete path exists anywhere in the codebase. */
export async function writeAudit(entry: AuditEntry, tx?: Transaction): Promise<void> {
  const entityId = safeUuid(entry.entityId);
  const organizationId = safeUuid(entry.organizationId);
  const actorUserId = safeUuid(entry.actorUserId);
  const tenantId = safeUuid(entry.tenantId);

  const extraMeta: Record<string, unknown> = {};
  if (entry.entityId && !entityId) extraMeta.rawEntityId = entry.entityId;
  if (entry.organizationId && !organizationId) extraMeta.rawOrganizationId = entry.organizationId;
  if (entry.actorUserId && !actorUserId) extraMeta.rawActorUserId = entry.actorUserId;

  const metadata = (entry.metadata || Object.keys(extraMeta).length > 0)
    ? { ...(entry.metadata ?? {}), ...extraMeta }
    : null;

  await AuditLog.create(
    {
      actorUserId,
      organizationId,
      tenantId,
      action: entry.action,
      entityType: entry.entityType,
      entityId,
      sourceIp: entry.sourceIp ?? null,
      result: entry.result,
      metadata,
    },
    { transaction: tx },
  );
}

