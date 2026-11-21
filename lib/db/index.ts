import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { drizzle as drizzleNode, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Database entry point.
 *
 * The app runs on a hosted Postgres instance in production and on PGlite (an
 * in-process Postgres compiled to WebAssembly) during local development and in
 * the test suite. Both speak the same dialect, so the schema, the SQL and the
 * transactions are identical; only the driver changes.
 */
export type Database = NodePgDatabase<typeof schema>;

type DbCache = {
  db: Database;
  pool?: Pool;
  pglite?: PGlite;
};

/** Cached across hot reloads in development so the connection is not rebuilt. */
const globalForDb = globalThis as unknown as { __loyaltyDb?: DbCache };

/**
 * True when no hosted database is configured. A "pglite:" prefix also forces the
 * embedded database, which is handy for demos that must not touch production.
 */
function usesEmbeddedDatabase(url: string | undefined): boolean {
  if (!url || url.startsWith("pglite:")) {
    return true;
  }
  return false;
}

/** The directory that holds the embedded database files. */
export const EMBEDDED_DATA_DIR = ".data/pglite";

/**
 * Create an embedded database. Tests pass ":memory:" so every run starts empty,
 * while local development persists to .data/pglite.
 */
export function createEmbeddedDatabase(dataDir?: string): {
  db: Database;
  client: PGlite;
} {
  // No argument means an in-memory database, which the test suite relies on.
  // PGlite creates its data directory but not the parent folder, so create it.
  if (dataDir) {
    mkdirSync(dirname(dataDir), { recursive: true });
  }
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzlePglite(client, { schema }) as unknown as Database;
  return { db, client };
}

/**
 * Return a singleton database handle. The first call decides the driver from the
 * environment; later calls reuse it, which keeps server actions cheap.
 */
export async function getDb(): Promise<Database> {
  const cached = globalForDb.__loyaltyDb;
  if (cached) {
    return cached.db;
  }

  const url = process.env.DATABASE_URL?.trim();

  if (usesEmbeddedDatabase(url)) {
    const { db, client } = createEmbeddedDatabase(EMBEDDED_DATA_DIR);
    // Wait for PGlite to boot before returning, so the first query cannot race.
    await client.waitReady;
    globalForDb.__loyaltyDb = { db, pglite: client };
    return db;
  }

  const isLocalHost = /(localhost|127\.0\.0\.1)/.test(url as string);
  const pool = new Pool({
    connectionString: url,
    // Hosted Postgres providers require TLS. Local servers usually do not.
    ssl: isLocalHost ? undefined : { rejectUnauthorized: false },
    max: 5,
  });
  const db = drizzleNode(pool, { schema }) as unknown as Database;
  globalForDb.__loyaltyDb = { db, pool };
  return db;
}

/** Release pooled connections. Used by scripts so Node can exit cleanly. */
export async function closeDb(): Promise<void> {
  const cached = globalForDb.__loyaltyDb;
  if (!cached) {
    return;
  }
  await cached.pool?.end();
  await cached.pglite?.close();
  globalForDb.__loyaltyDb = undefined;
}

export { schema };
