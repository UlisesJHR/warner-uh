import { and, eq, inArray, sql } from "drizzle-orm";
import {
  CUTOFF_DATE,
  SOURCE_API_BASE,
  SOURCE_MAX_PAGES,
  SOURCE_PAGE_SIZE,
} from "./constants";
import { convertToMxnCents, computeLoyalty } from "./loyalty";
import {
  clientAccounts,
  customers,
  customerMetrics,
  orders,
  payments,
  pointMovements,
  syncRuns,
} from "./db/schema";
import type { Database } from "./db";

/**
 * Source synchronisation.
 *
 * The job downloads every customer, order and payment with pagination, stores the
 * normalised rows, rebuilds the derived points ledger for every customer and
 * refreshes the cached metrics. Derived rows are the only thing ever deleted, so
 * running the job twice can never duplicate points or touch redemptions.
 */

type SourcePage = {
  data: unknown[];
  meta: { total_pages?: number; has_more?: boolean };
};

export type SyncResult = {
  runId: string;
  status: "success" | "failed";
  requests: number;
  records: number;
  message: string;
};

/** Read a value from an unknown object without trusting its shape. */
function read(record: unknown, key: string): unknown {
  if (record && typeof record === "object" && key in record) {
    return (record as Record<string, unknown>)[key];
  }
  return undefined;
}

/** Read a nested user id, because the API nests it as user.id in some resources. */
function readUserId(record: unknown): number | null {
  const user = read(record, "user");
  const candidates = [read(user, "id"), read(record, "user_id"), read(record, "customer_id")];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

/** Convert an unknown amount into integer cents of its own currency. */
function toCents(value: unknown): number {
  const numeric = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

/** ISO string for a timestamp, or null. Storage expects timestamptz or null. */
function toIso(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Normalised customer row, exported so the test suite can assert the mapping. */
export function normalizeUser(raw: unknown): {
  id: number;
  name: string;
  email: string;
  phone: string;
  dob: string | null;
  sourceCreatedAt: Date | null;
} | null {
  const id = Number(read(raw, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  const dob = read(raw, "dob");
  const createdAt = toIso(read(raw, "created_at"));
  return {
    id,
    name: String(read(raw, "name") ?? `Customer ${id}`),
    email: String(read(raw, "email") ?? "").toLowerCase(),
    phone: String(read(raw, "phone") ?? ""),
    // A birthday is a calendar date: keep the first 10 characters as given.
    dob: typeof dob === "string" ? dob.slice(0, 10) : null,
    sourceCreatedAt: createdAt ? new Date(createdAt) : null,
  };
}

/** Normalised order row. */
export function normalizeOrder(raw: unknown): {
  id: number;
  customerId: number;
  status: string;
  paymentStatus: string;
  totalCents: number;
  currency: string;
  sourceCreatedAt: Date | null;
} | null {
  const id = Number(read(raw, "id"));
  const customerId = readUserId(raw);
  if (!Number.isInteger(id) || id <= 0 || !customerId) {
    return null;
  }
  const createdAt = toIso(read(raw, "created_at"));
  return {
    id,
    customerId,
    status: String(read(raw, "status") ?? "").toLowerCase(),
    paymentStatus: String(read(raw, "payment_status") ?? "").toLowerCase(),
    totalCents: toCents(read(raw, "total")),
    currency: String(read(raw, "currency") ?? "MXN").toUpperCase(),
    sourceCreatedAt: createdAt ? new Date(createdAt) : null,
  };
}

/** Normalised payment row. Amounts in an unsupported currency are kept but score 0. */
export function normalizePayment(raw: unknown): {
  id: number;
  customerId: number;
  amountCents: number;
  currency: string;
  status: string;
  amountMxnCents: number;
  paidAt: Date | null;
  sourceCreatedAt: Date | null;
  orderId: number | null;
} | null {
  const id = Number(read(raw, "id"));
  const customerId = readUserId(raw);
  if (!Number.isInteger(id) || id <= 0 || !customerId) {
    return null;
  }
  const amountCents = toCents(read(raw, "amount"));
  const currency = String(read(raw, "currency") ?? "MXN").toUpperCase();
  const paidAt = toIso(read(raw, "paid_at"));
  const createdAt = toIso(read(raw, "created_at"));
  const metadata = read(raw, "metadata");
  const orderId = Number(read(metadata, "order_id"));

  return {
    id,
    customerId,
    amountCents,
    currency,
    status: String(read(raw, "status") ?? "").toLowerCase(),
    amountMxnCents: convertToMxnCents(amountCents / 100, currency) ?? 0,
    paidAt: paidAt ? new Date(paidAt) : null,
    sourceCreatedAt: createdAt ? new Date(createdAt) : null,
    orderId: Number.isInteger(orderId) && orderId > 0 ? orderId : null,
  };
}

/** Wait without blocking the event loop, used for 429 backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * How many pages of one resource may be in flight at the same time.
 *
 * A single page takes about one second, so 76 sequential pages used roughly a
 * minute and left no room inside the Vercel function limit. Four pages at a time
 * keeps the average duration near 20 seconds while staying far below the rate
 * limit that the source API enforces with 429 responses.
 */
const PAGE_CONCURRENCY = 4;

/**
 * Download one page, retrying after a 429.
 *
 * A 429 reads Retry-After, waits and retries a bounded number of times. Any other
 * failure is thrown, because a partial dataset would be worse than a failed run.
 */
async function fetchPage(
  resource: "users" | "orders" | "payments",
  apiKey: string,
  page: number,
  onRequest: () => void,
): Promise<{ rows: unknown[]; meta: SourcePage["meta"] }> {
  const url = new URL(`${SOURCE_API_BASE}/${resource}`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(SOURCE_PAGE_SIZE));

  let response: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    onRequest();
    if (response.status !== 429) {
      break;
    }
    const retryAfter = Number(response.headers.get("retry-after") ?? "5");
    await sleep(Math.min(30, Number.isFinite(retryAfter) ? retryAfter : 5) * 1000);
  }

  if (!response || !response.ok) {
    throw new Error(
      `Source request failed for ${resource} page ${page} with status ${response?.status ?? "unknown"}`,
    );
  }

  const body = (await response.json()) as SourcePage;
  return {
    rows: Array.isArray(body?.data) ? body.data : [],
    meta: body?.meta ?? {},
  };
}

/**
 * Download one resource with pagination.
 *
 * Page one is read first because its meta block announces the total page count.
 * The remaining pages are then requested in concurrent waves and reassembled in
 * page order, so the stored rows keep a deterministic sequence. When meta has no
 * total_pages the loop falls back to following has_more one page at a time.
 * SOURCE_MAX_PAGES caps both paths, so a broken meta block cannot run forever.
 */
async function fetchResource(
  resource: "users" | "orders" | "payments",
  apiKey: string,
  onRequest: () => void,
): Promise<unknown[]> {
  const first = await fetchPage(resource, apiKey, 1, onRequest);
  const pages: unknown[][] = [first.rows];
  const declared = Number(first.meta.total_pages);

  if (Number.isInteger(declared) && declared > 0) {
    const remaining: number[] = [];
    for (let page = 2; page <= Math.min(declared, SOURCE_MAX_PAGES); page += 1) {
      remaining.push(page);
    }

    const collected = new Map<number, unknown[]>();
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < remaining.length) {
        const page = remaining[next];
        next += 1;
        const result = await fetchPage(resource, apiKey, page, onRequest);
        collected.set(page, result.rows);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PAGE_CONCURRENCY, remaining.length) }, worker),
    );
    for (const page of remaining) {
      pages.push(collected.get(page) ?? []);
    }
  } else {
    let page = 2;
    let hasMore = Boolean(first.meta.has_more) && first.rows.length > 0;
    while (hasMore && page <= SOURCE_MAX_PAGES) {
      const result = await fetchPage(resource, apiKey, page, onRequest);
      pages.push(result.rows);
      hasMore = Boolean(result.meta.has_more) && result.rows.length > 0;
      page += 1;
    }
  }

  return pages.flat();
}

/**
 * Split a list into fixed size batches.
 *
 * Every write in the sync is a multi row statement, because one round trip per
 * row would need thousands of network calls and would never fit inside a Vercel
 * function time limit. 200 rows stays well below the Postgres parameter ceiling.
 */
function chunk<T>(rows: T[], size = 200): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    batches.push(rows.slice(start, start + size));
  }
  return batches;
}

/**
 * Create the portal account row that the sync owns for every customer.
 *
 * The account starts without a password, which is the "no access yet" state.
 * Existing accounts are read in one query per batch, so a re-sync does not touch
 * them. If the source email collides with another customer, a deterministic
 * fallback email keeps the unique index satisfied without dropping the customer.
 */
async function ensureClientAccounts(
  db: Database,
  rows: { customerId: number; email: string }[],
): Promise<void> {
  for (const batch of chunk(rows)) {
    const ids = batch.map((row) => row.customerId);
    const existing = await db
      .select({ customerId: clientAccounts.customerId })
      .from(clientAccounts)
      .where(inArray(clientAccounts.customerId, ids));
    const known = new Set(existing.map((row) => row.customerId));
    const missing = batch.filter((row) => !known.has(row.customerId));
    if (missing.length === 0) {
      continue;
    }

    // Rows whose email collides are skipped by this statement instead of
    // aborting the batch, so the second pass can give them a synthetic email.
    await db
      .insert(clientAccounts)
      .values(
        missing.map((row) => ({
          customerId: row.customerId,
          email: row.email || `customer-${row.customerId}@fidelizacion.local`,
        })),
      )
      .onConflictDoNothing();

    const created = await db
      .select({ customerId: clientAccounts.customerId })
      .from(clientAccounts)
      .where(inArray(clientAccounts.customerId, ids));
    const createdIds = new Set(created.map((row) => row.customerId));
    const stillMissing = missing.filter((row) => !createdIds.has(row.customerId));
    if (stillMissing.length > 0) {
      await db
        .insert(clientAccounts)
        .values(
          stillMissing.map((row) => ({
            customerId: row.customerId,
            email: `customer-${row.customerId}@fidelizacion.local`,
          })),
        )
        .onConflictDoNothing();
    }
  }
}

/**
 * Rebuild the derived ledger and cached metrics for every stored customer.
 *
 * Only movements produced by the source are deleted; redemptions and their
 * cancellation refunds survive every run, which is what makes re-syncing safe.
 */
export async function recalculateLoyalty(db: Database): Promise<number> {
  const customerRows = await db.select({ id: customers.id }).from(customers);
  if (customerRows.length === 0) {
    return 0;
  }

  const paymentRows = await db.select().from(payments);
  const orderRows = await db.select().from(orders);

  const paymentsByCustomer = new Map<number, (typeof paymentRows)[number][]>();
  for (const row of paymentRows) {
    const bucket = paymentsByCustomer.get(row.customerId) ?? [];
    bucket.push(row);
    paymentsByCustomer.set(row.customerId, bucket);
  }
  const ordersByCustomer = new Map<number, (typeof orderRows)[number][]>();
  for (const row of orderRows) {
    const bucket = ordersByCustomer.get(row.customerId) ?? [];
    bucket.push(row);
    ordersByCustomer.set(row.customerId, bucket);
  }

  const batchSize = 100;
  for (let start = 0; start < customerRows.length; start += batchSize) {
    const batch = customerRows.slice(start, start + batchSize);
    await db.transaction(async (tx) => {
      for (const customer of batch) {
        const snapshot = computeLoyalty({
          payments: (paymentsByCustomer.get(customer.id) ?? []).map((row) => ({
            id: row.id,
            amountCents: row.amountCents,
            currency: row.currency,
            status: row.status,
            paidAt: row.paidAt ? row.paidAt.toISOString() : null,
            createdAt: row.sourceCreatedAt ? row.sourceCreatedAt.toISOString() : null,
          })),
          orders: (ordersByCustomer.get(customer.id) ?? []).map((row) => ({
            id: row.id,
            status: row.status,
            paymentStatus: row.paymentStatus,
            createdAt: row.sourceCreatedAt ? row.sourceCreatedAt.toISOString() : null,
          })),
        });

        await tx
          .delete(pointMovements)
          .where(
            and(
              eq(pointMovements.customerId, customer.id),
              inArray(pointMovements.type, ["pago", "reembolso", "bono_orden_entregada"]),
            ),
          );

        if (snapshot.movements.length > 0) {
          await tx
            .insert(pointMovements)
            .values(
              snapshot.movements.map((movement) => ({
                customerId: customer.id,
                type: movement.type,
                reference: movement.reference,
                points: movement.points,
                occurredOn: movement.date,
              })),
            )
            .onConflictDoNothing();
        }

        await tx
          .insert(customerMetrics)
          .values({
            customerId: customer.id,
            pointsEarned: snapshot.pointsEarned,
            spendCents: snapshot.spendCents,
            level: snapshot.level,
            lastActivityOn: snapshot.lastActivityOn,
            daysInactive: snapshot.daysInactive,
            atRisk: snapshot.atRisk,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: customerMetrics.customerId,
            set: {
              pointsEarned: snapshot.pointsEarned,
              spendCents: snapshot.spendCents,
              level: snapshot.level,
              lastActivityOn: snapshot.lastActivityOn,
              daysInactive: snapshot.daysInactive,
              atRisk: snapshot.atRisk,
              updatedAt: new Date(),
            },
          });
      }
    });
  }

  return customerRows.length;
}

/**
 * Run a full synchronisation and record it.
 *
 * The run row is created before any network call, so an aborted function still
 * leaves evidence in the panel. Every failure is captured in the row and rethrown
 * to the caller so the endpoint or action can answer with the right status.
 */
export async function runSync(
  db: Database,
  options: { trigger: "cron" | "manual"; triggeredBy?: string | null },
): Promise<SyncResult> {
  const [run] = await db
    .insert(syncRuns)
    .values({
      trigger: options.trigger,
      triggeredBy: options.triggeredBy ?? null,
      status: "running",
    })
    .returning({ id: syncRuns.id });

  const runId = run.id;
  const apiKey = process.env.FAKEAPI_API_KEY?.trim();
  let requests = 0;
  let records = 0;
  const countRequest = () => {
    requests += 1;
  };

  try {
    if (!apiKey) {
      throw new Error("FAKEAPI_API_KEY is not configured");
    }

    const userRows = await fetchResource("users", apiKey, countRequest);
    const orderRows = await fetchResource("orders", apiKey, countRequest);
    const paymentRows = await fetchResource("payments", apiKey, countRequest);

    const normalizedCustomers = userRows
      .map(normalizeUser)
      .filter((row): row is NonNullable<typeof row> => row !== null);
    records += normalizedCustomers.length;

    // Customers are upserted in batches. The update set reads the incoming row
    // through `excluded`, which is how Postgres exposes the rejected insert.
    for (const batch of chunk(normalizedCustomers)) {
      await db
        .insert(customers)
        .values(batch.map((customer) => ({ ...customer, syncedAt: new Date() })))
        .onConflictDoUpdate({
          target: customers.id,
          set: {
            name: sql`excluded.name`,
            email: sql`excluded.email`,
            phone: sql`excluded.phone`,
            dob: sql`excluded.dob`,
            sourceCreatedAt: sql`excluded.source_created_at`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
    }
    await ensureClientAccounts(
      db,
      normalizedCustomers.map((customer) => ({
        customerId: customer.id,
        email: customer.email,
      })),
    );

    const knownCustomers = new Set(normalizedCustomers.map((row) => row.id));

    const normalizedOrders = orderRows
      .map(normalizeOrder)
      .filter(
        (row): row is NonNullable<typeof row> => row !== null && knownCustomers.has(row.customerId),
      );
    records += normalizedOrders.length;

    for (const batch of chunk(normalizedOrders)) {
      await db
        .insert(orders)
        .values(batch)
        .onConflictDoUpdate({
          target: orders.id,
          set: {
            customerId: sql`excluded.customer_id`,
            status: sql`excluded.status`,
            paymentStatus: sql`excluded.payment_status`,
            totalCents: sql`excluded.total_cents`,
            currency: sql`excluded.currency`,
            sourceCreatedAt: sql`excluded.source_created_at`,
          },
        });
    }

    const normalizedPayments = paymentRows
      .map(normalizePayment)
      .filter(
        (row): row is NonNullable<typeof row> => row !== null && knownCustomers.has(row.customerId),
      );
    records += normalizedPayments.length;

    for (const batch of chunk(normalizedPayments)) {
      await db
        .insert(payments)
        .values(batch)
        .onConflictDoUpdate({
          target: payments.id,
          set: {
            customerId: sql`excluded.customer_id`,
            amountCents: sql`excluded.amount_cents`,
            currency: sql`excluded.currency`,
            status: sql`excluded.status`,
            amountMxnCents: sql`excluded.amount_mxn_cents`,
            paidAt: sql`excluded.paid_at`,
            sourceCreatedAt: sql`excluded.source_created_at`,
            orderId: sql`excluded.order_id`,
          },
        });
    }

    const recalculated = await recalculateLoyalty(db);
    const message = `Synced ${normalizedCustomers.length} customers, ${normalizedOrders.length} orders and ${normalizedPayments.length} payments. Recalculated ${recalculated} customers as of ${CUTOFF_DATE}.`;

    await db
      .update(syncRuns)
      .set({
        status: "success",
        finishedAt: new Date(),
        requests,
        records,
        message,
      })
      .where(eq(syncRuns.id, runId));

    return { runId, status: "success", requests, records, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown synchronisation error";
    await db
      .update(syncRuns)
      .set({ status: "failed", finishedAt: new Date(), requests, records, message })
      .where(eq(syncRuns.id, runId));
    return { runId, status: "failed", requests, records, message };
  }
}
