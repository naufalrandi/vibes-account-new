import "dotenv/config";
import { Umzug, SequelizeStorage } from "umzug";
import { sequelize } from "./sequelize";

export const migrator = new Umzug({
  migrations: {
    glob: ["migrations/*.ts", { cwd: __dirname }],
    // Umzug's default loader uses Node's native module resolution, which cannot
    // transpile .ts files. Resolve each migration via dynamic import() so the
    // active loader (tsx for the CLI, Vitest's transformer under test) handles
    // the TypeScript instead. Keeps a single migration source for prod + tests.
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
