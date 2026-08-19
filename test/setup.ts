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
    // Only tolerate the module not existing yet (early milestones); any other
    // import failure (syntax/runtime error in the module) must still surface.
    if ((error as NodeJS.ErrnoException)?.code === "ERR_MODULE_NOT_FOUND") {
      return;
    }
    throw error;
  }
  ({ sequelize } = await import("../src/db/sequelize"));
  models.initModels();
  // Build the test schema by running the real Umzug migration instead of
  // sequelize.sync(). sync() derives the schema from the model definitions,
  // which omit `references` on FK columns — so it would produce a schema with
  // NO foreign keys and tests would not exercise the referential-integrity /
  // ON DELETE CASCADE constraints that production enforces. Running the actual
  // migration guarantees the test schema mirrors production exactly.
  const { migrator } = await import("../src/db/migrate");
  await sequelize.query('DROP SCHEMA IF EXISTS public CASCADE');
  await sequelize.query('CREATE SCHEMA public');
  await sequelize.query('GRANT ALL ON SCHEMA public TO public');
  await migrator.up();
});

afterAll(async () => {
  if (sequelize) {
    await sequelize.close();
  }
});
