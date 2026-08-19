import "dotenv/config";
import { sequelize } from "./sequelize";
import { migrator } from "./migrate";
import { seed } from "./seeders/seed";

export async function migrateFresh({ shouldSeed = false }: { shouldSeed?: boolean } = {}) {
  // Drop entire public schema with CASCADE and recreate cleanly
  await sequelize.query('DROP SCHEMA IF EXISTS public CASCADE');
  await sequelize.query('CREATE SCHEMA public');
  await sequelize.query('GRANT ALL ON SCHEMA public TO public');

  // Re-run all migrations from scratch
  await migrator.up();

  // Optionally seed
  if (shouldSeed) {
    await seed();
  }
}

if (require.main === module) {
  const withSeed = process.argv.includes("--seed") || process.argv.includes("-s");
  migrateFresh({ shouldSeed: withSeed })
    .then(() => sequelize.close())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Migrate fresh failed:", e);
      process.exit(1);
    });
}
