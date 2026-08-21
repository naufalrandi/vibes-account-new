import "dotenv/config";
import { sequelize } from "./sequelize";
import { migrator } from "./migrate";
import { seed } from "./seeders/seed";

export async function migrateFresh({ shouldSeed = false }: { shouldSeed?: boolean } = {}) {
  await sequelize.query(`
    DO $$ DECLARE
        r RECORD;
    BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
            EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
        FOR r IN (SELECT typname FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typtype = 'e') LOOP
            EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
        END LOOP;
    END $$;
  `);

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
