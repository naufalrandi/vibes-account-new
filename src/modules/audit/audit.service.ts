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

/** Append-only. No update/delete path exists anywhere in the codebase. */
export async function writeAudit(entry: AuditEntry, tx?: Transaction): Promise<void> {
  await AuditLog.create(
    {
      actorUserId: entry.actorUserId ?? null,
      organizationId: entry.organizationId ?? null,
      tenantId: entry.tenantId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      sourceIp: entry.sourceIp ?? null,
      result: entry.result,
      metadata: entry.metadata ?? null,
    },
    { transaction: tx },
  );
}
