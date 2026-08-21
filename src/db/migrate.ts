import "dotenv/config";
import { Umzug, SequelizeStorage } from "umzug";
import { sequelize } from "./sequelize";

const migrationExtension = __filename.endsWith(".ts") ? "ts" : "js";

class NormalizedSequelizeStorage extends SequelizeStorage {
  override async executed(): Promise<string[]> {
    const executed = await super.executed();
    return Array.from(new Set(executed.map((name) => name.replace(/\.(ts|js)$/, ""))));
  }

  override async logMigration(params: { name: string }): Promise<void> {
    const normalizedName = params.name.replace(/\.(ts|js)$/, "");
    await super.logMigration({ name: normalizedName });
  }

  override async unlogMigration(params: { name: string }): Promise<void> {
    const normalizedName = params.name.replace(/\.(ts|js)$/, "");
    await super.unlogMigration({ name: normalizedName });
  }
}

export function createMigrator() {
  return new Umzug({
    migrations: {
      glob: [`migrations/*.${migrationExtension}`, { cwd: __dirname }],
      resolve: ({ name, path, context }) => {
        if (!path) {
          throw new Error(`Migration ${name} is missing a file path`);
        }
        const normalizedName = name.replace(/\.(ts|js)$/, "");
        return {
          name: normalizedName,
          up: async () => (await import(path)).up({ context }),
          down: async () => (await import(path)).down({ context }),
        };
      },
    },
    context: sequelize.getQueryInterface(),
    storage: new NormalizedSequelizeStorage({ sequelize }),
    logger: console,
  });
}

export const migrator = createMigrator();

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
