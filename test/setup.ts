import "dotenv/config";
import { beforeAll, afterAll } from "vitest";

// Force test env before any DB module (env/sequelize/models) is evaluated.
process.env.NODE_ENV = "test";

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
  // Recreate the schema fresh for the whole test run.
  await sequelize.sync({ force: true });
});

afterAll(async () => {
  if (sequelize) {
    await sequelize.close();
  }
});
