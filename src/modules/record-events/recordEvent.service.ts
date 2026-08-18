import { RecordEvent } from "../../db/models/recordEvent.model";
import { User } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { BadRequestError } from "../../lib/errors";

export interface RecordEventView {
  id: string;
  type: "activity" | "comment";
  actor: string | null;
  text: string;
  createdAt: Date;
}

function view(e: RecordEvent): RecordEventView {
  return { id: e.id, type: e.type, actor: e.actor, text: e.text, createdAt: e.createdAt };
}

/** Resolves the caller's display name for attribution (activity log, justification stamps, etc). */
export async function actorName(auth: AuthContext): Promise<string | null> {
  const u = auth.userId ? await User.findByPk(auth.userId) : null;
  return u?.fullName ?? u?.username ?? null;
}

/** Newest-last timeline of activity + comments for a record, scoped to the caller's org. */
export async function listEvents(auth: AuthContext, module: string, recordId: string): Promise<RecordEventView[]> {
  const rows = await RecordEvent.findAll({ where: { orgId: auth.orgId, module, recordId }, order: [["createdAt", "ASC"]] });
  return rows.map(view);
}

export async function addComment(auth: AuthContext, module: string, recordId: string, text: string): Promise<RecordEventView> {
  if (!text || !text.trim()) throw new BadRequestError("Comment text is required", "TEXT_REQUIRED");
  const e = await RecordEvent.create({ orgId: auth.orgId, module, recordId, type: "comment", actor: await actorName(auth), text: text.trim() });
  return view(e);
}

/**
 * Append an auto-generated activity entry, scoped to the record's org (which may
 * differ from the actor's org when a Service Owner acts on a tenant's behalf).
 * Exported so register services can log create / update / status-change events.
 */
export async function logActivity(auth: AuthContext, orgId: string, module: string, recordId: string, text: string): Promise<void> {
  await RecordEvent.create({ orgId, module, recordId, type: "activity", actor: await actorName(auth), text });
}
