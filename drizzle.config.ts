import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration for generating SQL migrations.
 *
 * Generation is offline: it only reads the schema file and writes SQL into
 * ./drizzle. Applying those migrations is done by scripts/migrate.ts, which can
 * target either the local PGlite database or a hosted Postgres instance.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // A placeholder is enough for `drizzle-kit generate`; it never connects.
    url: process.env.DATABASE_URL ?? "postgresql://placeholder/placeholder",
  },
  strict: true,
  verbose: true,
});
