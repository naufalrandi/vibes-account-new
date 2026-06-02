import "dotenv/config";
import { Umzug, SequelizeStorage } from "umzug";
import { sequelize } from "./sequelize";

export const migrator = new Umzug({
  migrations: { glob: ["migrations/*.ts", { cwd: __dirname }] },
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
