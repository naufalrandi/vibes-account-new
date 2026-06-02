import "dotenv/config";
import { createApp } from "./app";
import { initModels } from "./db/models";
import { sequelize } from "./db/sequelize";
import { migrator } from "./db/migrate";
import { env } from "./config/env";

async function main() {
  initModels();
  await sequelize.authenticate();
  if (env.NODE_ENV !== "test") {
    await migrator.up();
  }
  createApp().listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`omnitenant-account listening on :${env.PORT}`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start:", e);
  process.exit(1);
});
