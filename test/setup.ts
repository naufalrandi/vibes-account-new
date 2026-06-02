import "dotenv/config";
import { beforeAll, afterAll } from "vitest";
import { sequelize } from "../src/db/sequelize";
import { initModels } from "../src/db/models";

// Force test env before models/connection are used.
process.env.NODE_ENV = "test";

beforeAll(async () => {
  initModels();
  // Recreate the schema fresh for the whole test run.
  await sequelize.sync({ force: true });
});

afterAll(async () => {
  await sequelize.close();
});
