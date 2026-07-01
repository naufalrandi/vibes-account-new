import "dotenv/config";
import { Umzug, SequelizeStorage } from "umzug";
import { sequelize } from "./sequelize";

const migrationExtension = __filename.endsWith(".ts") ? "ts" : "js";

export const migrator = new Umzug({
  migrations: {
    glob: [`migrations/*.${migrationExtension}`, { cwd: __dirname }],
    // Resolve each migration through the active runtime: tsx/Vitest in source
    // mode, plain Node after tsc emits dist/db/migrations/*.js.
    resolve: ({ name, path, context }) => {
      if (!path) {
        throw new Error(`Migration ${name} is missing a file path`);
      }
      return {
        name,
        up: async () => (await import(path)).up({ context }),
        down: async () => (await import(path)).down({ context }),
      };
    },
  },
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
});

export type Migration = typeof migrator._types.migration;

if (require.main === module) {
  const cmd = process.argv[2] ?? "up";
  migrator
    .runAsCLI([process.argv[2] ? cmd : "up"])
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
