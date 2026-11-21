import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Database schema for the loyalty programme.
 *
 * Money is stored as integer cents and dates that represent a calendar day are
 * stored as "YYYY-MM-DD" text. Both choices remove floating point rounding and
 * timezone drift from the numbers that the evaluation compares against.
 *
 * Source ids from fakeapi.dev are kept as the primary keys of customers, orders
 * and payments, which makes every synchronisation request an idempotent upsert.
 */

/** Internal staff accounts. Customers never appear in this table. */
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  /** Permissions are validated against the fixed catalogue in lib/constants. */
  permissions: text("permissions").array().notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const staffUsers = pgTable(
  "staff_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("staff_users_email_key").on(table.email)],
);

/** Synchronised customers, mirroring /users from the source API. */
export const customers = pgTable("customers", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  /** Calendar date taken from the first 10 characters of the source value. */
  dob: text("dob"),
  sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Portal accounts. The sync creates one row per customer with no password, so
 * the account exists but cannot be used until an internal user generates access.
 */
export const clientAccounts = pgTable(
  "client_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    active: boolean("active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("client_accounts_customer_key").on(table.customerId),
    uniqueIndex("client_accounts_email_key").on(table.email),
  ],
);

/**
 * Server side sessions for both account types. Only a SHA-256 hash of the cookie
 * token is stored, so a database leak cannot be replayed against the app.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    kind: text("kind").notNull(),
    staffUserId: uuid("staff_user_id").references(() => staffUsers.id, {
      onDelete: "cascade",
    }),
    clientAccountId: uuid("client_account_id").references(() => clientAccounts.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("sessions_token_hash_key").on(table.tokenHash)],
);

/** Hashed evaluation tokens for the public validation endpoints. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull(),
    prefix: text("prefix").notNull(),
    createdBy: uuid("created_by").references(() => staffUsers.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("api_tokens_hash_key").on(table.tokenHash)],
);

/** Orders from /orders, used for the delivery bonus and for activity. */
export const orders = pgTable(
  "orders",
  {
    id: integer("id").primaryKey(),
    customerId: integer("customer_id").notNull(),
    status: text("status").notNull().default(""),
    paymentStatus: text("payment_status").notNull().default(""),
    totalCents: integer("total_cents").notNull().default(0),
    currency: text("currency").notNull().default("MXN"),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
  },
  (table) => [index("orders_customer_idx").on(table.customerId)],
);

/** Payments from /payments with the converted MXN amount already computed. */
export const payments = pgTable(
  "payments",
  {
    id: integer("id").primaryKey(),
    customerId: integer("customer_id").notNull(),
    amountCents: integer("amount_cents").notNull().default(0),
    currency: text("currency").notNull().default("MXN"),
    status: text("status").notNull().default(""),
    amountMxnCents: integer("amount_mxn_cents").notNull().default(0),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    orderId: integer("order_id"),
  },
  (table) => [index("payments_customer_idx").on(table.customerId)],
);

/**
 * Points ledger. The unique key on (customer, type, reference) makes the sync
 * idempotent: replaying the same source rows can never duplicate a movement.
 */
export const pointMovements = pgTable(
  "point_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: integer("customer_id").notNull(),
    type: text("type").notNull(),
    reference: text("reference").notNull(),
    points: integer("points").notNull(),
    occurredOn: text("occurred_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("point_movements_unique_key").on(
      table.customerId,
      table.type,
      table.reference,
    ),
    index("point_movements_customer_idx").on(table.customerId),
  ],
);

/**
 * Cached aggregation per customer. It is recomputed from the ledger after every
 * sync, so the panel and the API never calculate points on each request.
 */
export const customerMetrics = pgTable("customer_metrics", {
  customerId: integer("customer_id").primaryKey(),
  pointsEarned: integer("points_earned").notNull().default(0),
  spendCents: integer("spend_cents").notNull().default(0),
  level: text("level").notNull().default("Bronce"),
  lastActivityOn: text("last_activity_on"),
  daysInactive: integer("days_inactive"),
  atRisk: boolean("at_risk").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Reward catalogue. Products and discounts share one table with a kind flag. */
export const rewards = pgTable("rewards", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url"),
  kind: text("kind").notNull().default("product"),
  pointsCost: integer("points_cost").notNull(),
  /** null means unlimited stock. */
  stock: integer("stock"),
  minLevel: text("min_level").notNull().default("Bronce"),
  perCustomerLimit: integer("per_customer_limit"),
  active: boolean("active").notNull().default(true),
  /** Discount only fields, stored in cents. */
  discountType: text("discount_type"),
  discountValueCents: integer("discount_value_cents"),
  minPurchaseCents: integer("min_purchase_cents"),
  validDays: integer("valid_days"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Redemptions. Points are always paired with a negative ledger movement. */
export const redemptions = pgTable(
  "redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: integer("customer_id").notNull(),
    rewardId: uuid("reward_id").notNull(),
    rewardName: text("reward_name").notNull(),
    pointsCost: integer("points_cost").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [index("redemptions_customer_idx").on(table.customerId)],
);

/** Coupons generated by discount redemptions, with a unique human readable code. */
export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    redemptionId: uuid("redemption_id").notNull(),
    customerId: integer("customer_id").notNull(),
    discountType: text("discount_type").notNull(),
    valueCents: integer("value_cents").notNull(),
    minPurchaseCents: integer("min_purchase_cents"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("valid"),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("coupons_code_key").on(table.code),
    uniqueIndex("coupons_redemption_key").on(table.redemptionId),
  ],
);

/** One row per synchronisation attempt, including manual runs and cron runs. */
export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  trigger: text("trigger").notNull().default("cron"),
  triggeredBy: text("triggered_by"),
  status: text("status").notNull().default("running"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  requests: integer("requests").notNull().default(0),
  records: integer("records").notNull().default(0),
  message: text("message").notNull().default(""),
});
