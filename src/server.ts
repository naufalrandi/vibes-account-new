import "dotenv/config";
import type { Server } from "node:http";
import { Op } from "sequelize";
import { createApp } from "./app";
import { initModels, RefreshToken } from "./db/models";
import { sequelize } from "./db/sequelize";
import { migrateUpLocked } from "./db/migrate";
import { assertServerConfig, env } from "./config/env";
import { loadFeatures } from "./modules/ai/features/registry";

const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Drop refresh tokens that expired or were revoked more than 30 days ago. */
async function pruneRefreshTokens(): Promise<number> {
  const cutoff = new Date(Date.now() - PRUNE_AFTER_MS);
  return RefreshToken.destroy({
    where: { [Op.or]: [{ expiresAt: { [Op.lt]: cutoff } }, { revokedAt: { [Op.lt]: cutoff } }] },
  });
}

function shutdown(server: Server, signal: string): void {
  // eslint-disable-next-line no-console
  console.log(`${signal} received — draining connections`);
  const force = setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error(`Shutdown timed out after ${env.SHUTDOWN_TIMEOUT_MS}ms — forcing exit`);
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);
  force.unref();
  server.close(async (err) => {
    try {
      await sequelize.close();
    } finally {
      process.exit(err ? 1 : 0);
    }
  });
  server.closeIdleConnections();
}

async function main() {
  assertServerConfig(env);
  initModels();
  await loadFeatures(); // a broken *.feature.ts fails boot, not the first request
  await sequelize.authenticate();
  if (env.NODE_ENV !== "test") {
    await migrateUpLocked();
    // Housekeeping — never worth failing boot over.
    await pruneRefreshTokens().then(
      // eslint-disable-next-line no-console
      (n) => n && console.log(`Pruned ${n} stale refresh token(s)`),
      // eslint-disable-next-line no-console
      (e) => console.error("Refresh token prune failed:", e),
    );
  }
  const server = createApp().listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`omnitenant-account listening on :${env.PORT}`);
  });
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      shutdown(server, signal);
    });
  }
}

process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  // State is unknown after an uncaught exception — log and exit; the orchestrator restarts us.
  // eslint-disable-next-line no-console
  console.error("Uncaught exception:", err);
  process.exit(1);
});

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start:", e);
  process.exit(1);
});
