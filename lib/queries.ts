import { and, asc, desc, eq, gte, ilike, isNull, or, sql } from "drizzle-orm";
import {
  BIRTHDAY_WINDOW_DAYS,
  CUTOFF_DATE,
  LEVELS,
  LEVEL_MIN_SPEND_CENTS,
  type Level,
} from "./constants";
import { addDays, levelForSpend, nextLevelProgress, upcomingBirthday } from "./loyalty";
import { getDb } from "./db";
import {
  apiTokens,
  clientAccounts,
  coupons,
  customers,
  customerMetrics,
  orders,
  payments,
  pointMovements,
  redemptions,
  rewards,
  roles,
  staffUsers,
  syncRuns,
} from "./db/schema";

/**
 * Read queries for the panel, the portal and the public API.
 *
 * Pages always read from this database, never from the source API. The helpers
 * here keep the joins in one place so every screen uses the same level, points
 * and risk definitions.
 */

export type CustomerRow = {
  id: number;
  name: string;
  email: string;
  dob: string | null;
  level: string;
  pointsEarned: number;
  spendCents: number;
  daysInactive: number | null;
  atRisk: boolean;
  hasAccess: boolean;
};

/** Dashboard headline numbers plus the level distribution. */
export async function getDashboardSummary(): Promise<{
  totalCustomers: number;
  totalPoints: number;
  atRisk: number;
  birthdays: number;
  byLevel: { level: Level; count: number }[];
  topCustomers: CustomerRow[];
  lastSync: { status: string; startedAt: Date; finishedAt: Date | null; message: string } | null;
}> {
  const db = await getDb();

  const [totals] = await db
    .select({
      totalCustomers: sql<string>`count(*)`,
      totalPoints: sql<string>`coalesce(sum(${customerMetrics.pointsEarned}), 0)`,
      atRisk: sql<string>`coalesce(sum(case when ${customerMetrics.atRisk} then 1 else 0 end), 0)`,
    })
    .from(customerMetrics);

  const levelRows = await db
    .select({ level: customerMetrics.level, count: sql<string>`count(*)` })
    .from(customerMetrics)
    .groupBy(customerMetrics.level);

  const [birthdayRow] = await db
    .select({ total: sql<string>`count(*)` })
    .from(customers)
    .where(sql`substring(${customers.dob}, 6, 5) in (${sql.join(birthdayMonthDays(), sql`, `)})`);

  const topCustomers = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      dob: customers.dob,
      level: customerMetrics.level,
      pointsEarned: customerMetrics.pointsEarned,
      spendCents: customerMetrics.spendCents,
      daysInactive: customerMetrics.daysInactive,
      atRisk: customerMetrics.atRisk,
      accountId: clientAccounts.id,
      passwordHash: clientAccounts.passwordHash,
    })
    .from(customers)
    .innerJoin(customerMetrics, eq(customerMetrics.customerId, customers.id))
    .leftJoin(clientAccounts, eq(clientAccounts.customerId, customers.id))
    .orderBy(desc(customerMetrics.pointsEarned), asc(customers.id))
    .limit(10);

  const [lastSync] = await db
    .select({
      status: syncRuns.status,
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
      message: syncRuns.message,
    })
    .from(syncRuns)
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  return {
    totalCustomers: Number(totals?.totalCustomers ?? 0),
    totalPoints: Number(totals?.totalPoints ?? 0),
    atRisk: Number(totals?.atRisk ?? 0),
    birthdays: Number(birthdayRow?.total ?? 0),
    byLevel: LEVELS.map((level) => ({
      level,
      count: Number(levelRows.find((row) => row.level === level)?.count ?? 0),
    })),
    topCustomers: topCustomers.map(mapCustomerRow),
    lastSync: lastSync ?? null,
  };
}

/** Month/day pairs inside the birthday window, used to filter in SQL. */
function birthdayMonthDays(): string[] {
  const values: string[] = [];
  for (let offset = 0; offset <= BIRTHDAY_WINDOW_DAYS; offset += 1) {
    values.push(addDays(CUTOFF_DATE, offset).slice(5));
  }
  return values;
}

/** Normalise the joined customer row into the shape the UI consumes. */
function mapCustomerRow(row: {
  id: number;
  name: string;
  email: string;
  dob: string | null;
  level: string;
  pointsEarned: number;
  spendCents: number;
  daysInactive: number | null;
  atRisk: boolean;
  accountId: string | null;
  passwordHash: string | null;
}): CustomerRow {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    dob: row.dob,
    level: row.level,
    pointsEarned: row.pointsEarned,
    spendCents: row.spendCents,
    daysInactive: row.daysInactive,
    atRisk: row.atRisk,
    hasAccess: Boolean(row.accountId && row.passwordHash),
  };
}

/**
 * Search customers by name, email or source id.
 *
 * An empty query returns the most recent customers so the screen is never blank.
 */
export async function searchCustomers(query: string, limit = 50): Promise<CustomerRow[]> {
  const db = await getDb();
  const term = query.trim();
  const numeric = Number(term);
  const filter = term
    ? or(
        ilike(customers.name, `%${term}%`),
        ilike(customers.email, `%${term}%`),
        Number.isInteger(numeric) && numeric > 0 ? eq(customers.id, numeric) : undefined,
      )
    : undefined;

  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      dob: customers.dob,
      level: customerMetrics.level,
      pointsEarned: customerMetrics.pointsEarned,
      spendCents: customerMetrics.spendCents,
      daysInactive: customerMetrics.daysInactive,
      atRisk: customerMetrics.atRisk,
      accountId: clientAccounts.id,
      passwordHash: clientAccounts.passwordHash,
    })
    .from(customers)
    .innerJoin(customerMetrics, eq(customerMetrics.customerId, customers.id))
    .leftJoin(clientAccounts, eq(clientAccounts.customerId, customers.id))
    .where(filter)
    .orderBy(asc(customers.name))
    .limit(limit);

  return rows.map(mapCustomerRow);
}

/** Everything the customer detail screen and the public API need. */
export async function getCustomerDetail(customerId: number) {
  const db = await getDb();
  const [customer] = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      dob: customers.dob,
      syncedAt: customers.syncedAt,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!customer) {
    return null;
  }

  const [metrics] = await db
    .select()
    .from(customerMetrics)
    .where(eq(customerMetrics.customerId, customerId))
    .limit(1);

  const [account] = await db
    .select({
      id: clientAccounts.id,
      email: clientAccounts.email,
      mustChangePassword: clientAccounts.mustChangePassword,
      hasPassword: sql<boolean>`${clientAccounts.passwordHash} is not null`,
      active: clientAccounts.active,
      lastLoginAt: clientAccounts.lastLoginAt,
    })
    .from(clientAccounts)
    .where(eq(clientAccounts.customerId, customerId))
    .limit(1);

  const movements = await db
    .select({
      date: pointMovements.occurredOn,
      type: pointMovements.type,
      reference: pointMovements.reference,
      points: pointMovements.points,
    })
    .from(pointMovements)
    .where(eq(pointMovements.customerId, customerId))
    .orderBy(desc(pointMovements.occurredOn), desc(pointMovements.createdAt))
    .limit(100);

  const [balance] = await db
    .select({ total: sql<string>`coalesce(sum(${pointMovements.points}), 0)` })
    .from(pointMovements)
    .where(eq(pointMovements.customerId, customerId));

  const [counts] = await db
    .select({
      orders: sql<string>`(select count(*) from ${orders} where ${orders.customerId} = ${customerId})`,
      payments: sql<string>`(select count(*) from ${payments} where ${payments.customerId} = ${customerId})`,
    })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  const spendCents = metrics?.spendCents ?? 0;
  return {
    customer,
    metrics: {
      pointsEarned: metrics?.pointsEarned ?? 0,
      pointsAvailable: Number(balance?.total ?? 0),
      spendCents,
      level: metrics ? levelForSpend(spendCents) : ("Bronce" as Level),
      daysInactive: metrics?.daysInactive ?? null,
      atRisk: metrics?.atRisk ?? false,
      lastActivityOn: metrics?.lastActivityOn ?? null,
      progress: nextLevelProgress(spendCents),
    },
    account: account ?? null,
    movements,
    orderCount: Number(counts?.orders ?? 0),
    paymentCount: Number(counts?.payments ?? 0),
  };
}

/** Customers flagged at risk, most inactive first. */
export async function getRiskCustomers(): Promise<CustomerRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      dob: customers.dob,
      level: customerMetrics.level,
      pointsEarned: customerMetrics.pointsEarned,
      spendCents: customerMetrics.spendCents,
      daysInactive: customerMetrics.daysInactive,
      atRisk: customerMetrics.atRisk,
      accountId: clientAccounts.id,
      passwordHash: clientAccounts.passwordHash,
    })
    .from(customers)
    .innerJoin(customerMetrics, eq(customerMetrics.customerId, customers.id))
    .leftJoin(clientAccounts, eq(clientAccounts.customerId, customers.id))
    .where(eq(customerMetrics.atRisk, true))
    .orderBy(desc(customerMetrics.daysInactive))
    .limit(500);
  return rows.map(mapCustomerRow);
}

/** Upcoming birthdays inside the window that starts at the cutoff. */
export async function getUpcomingBirthdays(): Promise<
  { id: number; name: string; email: string; dob: string; date: string; level: string }[]
> {
  const db = await getDb();
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      dob: customers.dob,
      level: sql<string>`coalesce(${customerMetrics.level}, 'Bronce')`,
    })
    .from(customers)
    .leftJoin(customerMetrics, eq(customerMetrics.customerId, customers.id))
    .where(sql`substring(${customers.dob}, 6, 5) in (${sql.join(birthdayMonthDays(), sql`, `)})`)
    .orderBy(asc(customers.name))
    .limit(500);

  return rows
    .map((row) => {
      const date = upcomingBirthday(row.dob);
      return date ? { ...row, dob: row.dob as string, date } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

/** Full reward catalogue, newest first. */
export async function listRewards() {
  const db = await getDb();
  return db.select().from(rewards).orderBy(desc(rewards.createdAt));
}

/** One reward for the edit screen. */
export async function getReward(rewardId: string) {
  const db = await getDb();
  const [reward] = await db.select().from(rewards).where(eq(rewards.id, rewardId)).limit(1);
  return reward ?? null;
}

/** Redemptions with the customer name, optionally filtered by status. */
export async function listRedemptions(status?: string) {
  const db = await getDb();
  const rows = await db
    .select({
      id: redemptions.id,
      customerId: redemptions.customerId,
      customerName: customers.name,
      rewardName: redemptions.rewardName,
      pointsCost: redemptions.pointsCost,
      status: redemptions.status,
      createdAt: redemptions.createdAt,
      code: coupons.code,
      expiresAt: coupons.expiresAt,
    })
    .from(redemptions)
    .innerJoin(customers, eq(customers.id, redemptions.customerId))
    .leftJoin(coupons, eq(coupons.redemptionId, redemptions.id))
    .where(status ? eq(redemptions.status, status) : undefined)
    .orderBy(desc(redemptions.createdAt))
    .limit(200);
  return rows.map((row) => ({
    ...row,
    couponStatus: row.expiresAt
      ? row.expiresAt.getTime() < Date.now()
        ? "expired"
        : "valid"
      : null,
  }));
}

/** Internal users with their role name. */
export async function listStaffUsers() {
  const db = await getDb();
  return db
    .select({
      id: staffUsers.id,
      name: staffUsers.name,
      email: staffUsers.email,
      active: staffUsers.active,
      roleId: staffUsers.roleId,
      roleName: roles.name,
      lastLoginAt: staffUsers.lastLoginAt,
      createdAt: staffUsers.createdAt,
    })
    .from(staffUsers)
    .innerJoin(roles, eq(roles.id, staffUsers.roleId))
    .orderBy(asc(staffUsers.name));
}

/** Editable roles. */
export async function listRoles() {
  const db = await getDb();
  return db.select().from(roles).orderBy(asc(roles.name));
}

/** One role with the number of users that hold it. */
export async function getRole(roleId: string) {
  const db = await getDb();
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) {
    return null;
  }
  const [count] = await db
    .select({ total: sql<string>`count(*)` })
    .from(staffUsers)
    .where(eq(staffUsers.roleId, roleId));
  return { ...role, userCount: Number(count?.total ?? 0) };
}

/** API tokens without their hashes. */
export async function listApiTokens() {
  const db = await getDb();
  return db
    .select({
      id: apiTokens.id,
      label: apiTokens.label,
      prefix: apiTokens.prefix,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .orderBy(desc(apiTokens.createdAt));
}

/** Recent synchronisation runs for the sync screen. */
export async function listSyncRuns(limit = 20) {
  const db = await getDb();
  return db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(limit);
}

/** Portal overview: balance, level, progress and the latest movements. */
export async function getPortalOverview(customerId: number) {
  const detail = await getCustomerDetail(customerId);
  if (!detail) {
    return null;
  }
  const db = await getDb();
  const movements = await db
    .select({
      date: pointMovements.occurredOn,
      type: pointMovements.type,
      reference: pointMovements.reference,
      points: pointMovements.points,
    })
    .from(pointMovements)
    .where(eq(pointMovements.customerId, customerId))
    .orderBy(desc(pointMovements.occurredOn), desc(pointMovements.createdAt))
    .limit(25);

  return { ...detail, movements };
}

/** Active reward catalogue for the portal, annotated with eligibility. */
export async function getPortalCatalog(customerId: number) {
  const db = await getDb();
  const [metrics] = await db
    .select({ spendCents: customerMetrics.spendCents })
    .from(customerMetrics)
    .where(eq(customerMetrics.customerId, customerId))
    .limit(1);
  const level = levelForSpend(metrics?.spendCents ?? 0);
  const [balance] = await db
    .select({ total: sql<string>`coalesce(sum(${pointMovements.points}), 0)` })
    .from(pointMovements)
    .where(eq(pointMovements.customerId, customerId));

  const items = await db
    .select()
    .from(rewards)
    .where(eq(rewards.active, true))
    .orderBy(asc(rewards.pointsCost));

  const eligibleLevels = LEVELS;
  return {
    level,
    availablePoints: Number(balance?.total ?? 0),
    items: items.map((item) => ({
      ...item,
      meetsLevel: eligibleLevels.indexOf(item.minLevel as Level) <= eligibleLevels.indexOf(level),
      inStock: item.stock === null || item.stock > 0,
      affordable: item.pointsCost <= Number(balance?.total ?? 0),
    })),
  };
}

/** Redemptions and coupons for one customer, scoped by customer id. */
export async function getPortalRedemptions(customerId: number) {
  const db = await getDb();
  const rows = await db
    .select({
      id: redemptions.id,
      rewardName: redemptions.rewardName,
      pointsCost: redemptions.pointsCost,
      status: redemptions.status,
      createdAt: redemptions.createdAt,
      couponCode: coupons.code,
      couponStatus: coupons.status,
      expiresAt: coupons.expiresAt,
    })
    .from(redemptions)
    .leftJoin(coupons, eq(coupons.redemptionId, redemptions.id))
    .where(eq(redemptions.customerId, customerId))
    .orderBy(desc(redemptions.createdAt))
    .limit(100);

  return rows.map((row) => ({
    ...row,
    couponStatus: row.expiresAt
      ? row.expiresAt.getTime() < Date.now() && row.couponStatus === "valid"
        ? "expired"
        : row.couponStatus
      : null,
  }));
}

/** Count of unredeemed, unexpired coupons, used for the portal badge. */
export async function countActiveCoupons(customerId: number): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<string>`count(*)` })
    .from(coupons)
    .where(
      and(
        eq(coupons.customerId, customerId),
        eq(coupons.status, "valid"),
        gte(coupons.expiresAt, new Date()),
      ),
    );
  return Number(row?.total ?? 0);
}

/** Level thresholds exposed for the portal progress bar. */
export function levelThresholds() {
  return LEVEL_MIN_SPEND_CENTS;
}

/** Unused import guard for the reward level list, kept for readability. */
export const levelList = LEVELS;

/** Customers without a portal account, which the panel can flag. */
export async function countCustomersWithoutAccess(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<string>`count(*)` })
    .from(customers)
    .leftJoin(clientAccounts, eq(clientAccounts.customerId, customers.id))
    .where(isNull(clientAccounts.passwordHash));
  return Number(row?.total ?? 0);
}
