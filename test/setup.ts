import "dotenv/config";
import { beforeAll, beforeEach, afterAll } from "vitest";
import { resetRateLimits } from "../src/middleware/rateLimit";

// Force test env before any DB module (env/sequelize/models) is evaluated.
process.env.NODE_ENV = "test";

// The auth rate limiter is module-level and, with fileParallelism:false, shared
// across the whole suite within one process. Reset it before every test so
// login/activate-heavy integration tests can't trip the limit on each other.
beforeEach(() => resetRateLimits());

// Lazily loaded so this harness file imports cleanly even before the models
// module exists (it lands in a later milestone). The connection is only opened
// once models are available, so pure unit tests never touch the database.
let sequelize: typeof import("../src/db/sequelize")["sequelize"] | undefined;

beforeAll(async () => {
  let models: typeof import("../src/db/models");
  try {
    models = await import("../src/db/models");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND") {
      return;
    }
    throw error;
  }
  const { migrator } = await import("../src/db/migrate");
  await migrator.up();
  ({ sequelize } = await import("../src/db/sequelize"));
  models.initModels();
});


afterAll(async () => {
  if (sequelize) {
    await sequelize.close();
  }
});
