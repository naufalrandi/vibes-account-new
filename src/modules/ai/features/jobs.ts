import { QueryTypes } from "sequelize";
import { AiJob, Organization, User } from "../../../db/models";
import { sequelize } from "../../../db/sequelize";
import { AppError, ForbiddenError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { getEffectiveAccess } from "../../iam/access.service";
import { resolveAction } from "./features.service";
import { listFeatures, loadFeatures } from "./registry";
import { runAction } from "./runtime";

/** Worker internals (src/worker.ts). Exported for tests. */

export const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 60_000;
// ponytail: a job still "running" after this is assumed orphaned by a dead worker and is re-claimed.
const STALE_LOCK_MINUTES = 15;

/** The job owner's AuthContext, rebuilt the way `authenticate` does, or null if they may no longer act. */
async function authFor(job: AiJob): Promise<AuthContext | null> {
  if (!job.userId) return null;
  const user = await User.findOne({ where: { id: job.userId, orgId: job.orgId }, include: [Organization] });
  const org = user?.get("Organization") as Organization | undefined;
  if (!user || !org) return null;
  const access = await getEffectiveAccess(user.id);
  if (!access.active) return null;
  return {
    userId: user.id, orgId: user.orgId, tenantId: user.tenantId, orgType: org.type,
    isSuperAdmin: access.isSuperAdmin, actions: access.actionKeys,
  };
}

export const ORPHANED_JOB_ERROR = "Worker stopped while running this job";

/**
 * Atomically claim the next due job (queued, or orphaned while running). An orphan
 * with no attempts left is never re-claimed, so it is failed here instead of
 * showing "running" forever.
 */
async function claimJob(): Promise<AiJob | null> {
  await sequelize.query(
    `UPDATE ai_jobs SET status = 'failed', error = :error, locked_at = NULL, updated_at = NOW()
      WHERE status = 'running' AND locked_at < NOW() - INTERVAL '${STALE_LOCK_MINUTES} minutes' AND attempts >= ${MAX_ATTEMPTS}`,
    { replacements: { error: ORPHANED_JOB_ERROR } },
  );
  const rows = await sequelize.query<{ id: string; org_id: string }>(
    `UPDATE ai_jobs SET status = 'running', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW()
      WHERE id = (
        SELECT id FROM ai_jobs
         WHERE (status = 'queued' AND run_after <= NOW())
            OR (status = 'running' AND locked_at < NOW() - INTERVAL '${STALE_LOCK_MINUTES} minutes' AND attempts < ${MAX_ATTEMPTS})
         ORDER BY run_after
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
      RETURNING id, org_id`,
    { type: QueryTypes.SELECT },
  );
  return rows[0] ? AiJob.findOne({ where: { id: rows[0].id, orgId: rows[0].org_id } }) : null;
}

/** Run one due job. Resolves false when there was nothing to do. */
export async function processOneJob(): Promise<boolean> {
  await loadFeatures();
  const job = await claimJob();
  if (!job) return false;
  try {
    const auth = await authFor(job);
    if (!auth) throw new ForbiddenError("The user who started this job can no longer run it");
    const { def } = await resolveAction(auth, job.feature, job.action);
    const input = def.input.parse(job.payload);
    const result = await runAction({
      feature: job.feature, action: job.action, def, auth, ip: null, input,
      progress: async (done, total) => {
        await job.update({ progress: done, total });
      },
    });
    await job.update({ status: "done", result: result ?? null, error: null, lockedAt: null });
  } catch (e) {
    // Client-side errors (403, 400, …) will not fix themselves; provider/unknown errors get one retry.
    const permanent = e instanceof AppError && e.status < 500;
    const retry = !permanent && job.attempts < MAX_ATTEMPTS;
    if (!(e instanceof AppError)) console.error(`AI job ${job.id} (${job.feature}/${job.action}) failed:`, e);
    await job.update({
      status: retry ? "queued" : "failed",
      error: e instanceof AppError ? e.message : "The job failed",
      lockedAt: null,
      ...(retry ? { runAfter: new Date(Date.now() + RETRY_DELAY_MS) } : {}),
    });
  }
  return true;
}

/**
 * Run every registered schedule whose last run is older than `everyMinutes`.
 * An advisory lock per key keeps two workers from running the same one.
 * ponytail: a failed run still counts as a run (logged, retried next interval) so a broken task cannot hammer the AI every minute.
 */
export async function runDueSchedules(): Promise<string[]> {
  await loadFeatures();
  const ran: string[] = [];
  for (const schedule of listFeatures().flatMap((f) => f.schedules ?? [])) {
    await sequelize.transaction(async (transaction) => {
      const [{ locked }] = await sequelize.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_xact_lock(hashtext(:k)) AS locked",
        { replacements: { k: `ai-schedule:${schedule.key}` }, type: QueryTypes.SELECT, transaction },
      );
      if (!locked) return;
      const [due] = await sequelize.query<{ due: boolean }>(
        `SELECT NOT EXISTS (SELECT 1 FROM ai_schedule_runs WHERE key = :k AND last_run_at > NOW() - make_interval(mins => :m)) AS due`,
        { replacements: { k: schedule.key, m: schedule.everyMinutes }, type: QueryTypes.SELECT, transaction },
      );
      if (!due.due) return;
      try {
        await schedule.run();
      } catch (e) {
        console.error(`AI schedule ${schedule.key} failed:`, e);
      }
      await sequelize.query(
        `INSERT INTO ai_schedule_runs (key, last_run_at) VALUES (:k, NOW())
         ON CONFLICT (key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at`,
        { replacements: { k: schedule.key }, transaction },
      );
      ran.push(schedule.key);
    });
  }
  return ran;
}
