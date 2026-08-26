import { PersonnelActivityLog } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { requireManagedUser } from "./user.service";
import { actorName } from "../record-events/recordEvent.service";
import { BadRequestError } from "../../lib/errors";

/**
 * Activity timeline (OD `ent-personnel` Activity tab, `modules.js:1178-1216`
 * tab list). Explicit append-only log table rather than a read-model, so
 * other personnel-record writes (contract docs, comp/bank, onboarding) can
 * post freeform entries alongside manual notes.
 */
export async function logPersonnelActivity(
  auth: AuthContext,
  orgId: string,
  userId: string,
  action: string,
  detail?: string | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  await PersonnelActivityLog.create({
    orgId,
    userId,
    actor: await actorName(auth),
    action,
    detail: detail ?? null,
    meta: meta ?? {},
  });
}

export async function listPersonnelActivity(auth: AuthContext, userId: string) {
  const user = await requireManagedUser(auth, userId);
  return (
    await PersonnelActivityLog.findAll({ where: { userId, orgId: user.orgId }, order: [["createdAt", "DESC"]] })
  ).map((r) => r.get({ plain: true }));
}

/** Manual freeform entry (a user note, not tied to a specific record write). */
export async function addPersonnelActivity(auth: AuthContext, userId: string, action: string, detail?: string | null) {
  const user = await requireManagedUser(auth, userId);
  if (!action || !action.trim()) throw new BadRequestError("action is required", "ACTION_REQUIRED");
  await logPersonnelActivity(auth, user.orgId, userId, action.trim(), detail ?? null);
}
