import { migrate as migrateNode } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { closeDb, getDb } from "../lib/db";
import { EMBEDDED_DATA_DIR } from "../lib/db";

/**
 * Apply the generated SQL migrations.
 *
 * The same script handles both targets: hosted Postgres via DATABASE_URL, or the
 * local PGlite file when no URL is configured. Loading .env here keeps the script
 * behaviour aligned with `next dev`, which reads it automatically.
 */
try {
  process.loadEnvFile?.(".env");
} catch {
  // A missing .env is fine: the local PGlite database will be used instead.
}

async function main(): Promise<void> {
  const db = await getDb();
  if (!process.env.DATABASE_URL?.trim()) {
    await migratePglite(db as never, { migrationsFolder: "./drizzle" });
    await closeDb();
    console.log(`Migrations applied to the embedded database at ${EMBEDDED_DATA_DIR}.`);
    return;
  }

  await migrateNode(db as never, { migrationsFolder: "./drizzle" });
  await closeDb();
  console.log("Migrations applied to DATABASE_URL.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
