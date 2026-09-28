import "dotenv/config";
import { initModels } from "./db/models";
import { sequelize } from "./db/sequelize";
import { loadFeatures } from "./modules/ai/features/registry";
import { processOneJob, runDueSchedules } from "./modules/ai/features/jobs";

/**
 * AI worker: runs queued feature jobs (`ai_jobs`) and scheduled feature tasks.
 * `npm run worker` (built) / `npm run worker:dev`. It does not run migrations —
 * the API does that at boot. Safe to run several: jobs are claimed with
 * FOR UPDATE SKIP LOCKED, schedules under a per-key advisory lock.
 */
export { processOneJob, runDueSchedules };

const JOB_POLL_MS = 15_000;
const SCHEDULE_CHECK_MS = 60_000;

let stopping = false;
let wake: (() => void) | null = null;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(t);
      resolve();
    };
  });

async function main(): Promise<void> {
  initModels();
  await loadFeatures();
  await sequelize.authenticate();
  console.log("AI worker started");
  let nextScheduleCheck = 0;
  while (!stopping) {
    try {
      if (Date.now() >= nextScheduleCheck) {
        nextScheduleCheck = Date.now() + SCHEDULE_CHECK_MS;
        await runDueSchedules();
      }
      // Drain every due job, then wait for the next poll.
      while (!stopping && (await processOneJob()));
    } catch (e) {
      console.error("AI worker loop error:", e);
    }
    if (!stopping) await sleep(JOB_POLL_MS);
  }
  await sequelize.close();
  console.log("AI worker stopped");
}

if (require.main === module) {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      console.log(`${signal} received — finishing the current job`);
      stopping = true;
      wake?.();
    });
  }
  main().then(
    () => process.exit(0),
    (e) => {
      console.error("AI worker failed to start:", e);
      process.exit(1);
    },
  );
}
