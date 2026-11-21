/**
 * Business constants for the loyalty program.
 *
 * Every rule in the specification is evaluated as of a fixed cutoff date instead
 * of "today", so the whole calculation is reproducible and testable. Keeping the
 * date, the exchange rates and the thresholds in one module means the rules have a
 * single source of truth that both the sync job and the UI read.
 */
export const CUTOFF_DATE = "2026-04-30";

/** Mexico has used a fixed UTC-6 offset without daylight saving since 2022. */
export const MEXICO_UTC_OFFSET_MINUTES = -360;

/**
 * Fixed exchange rates to MXN. A payment in a currency that is absent from this
 * map is ignored instead of being guessed, which matches the specification.
 */
export const CURRENCY_RATES_TO_MXN: Readonly<Record<string, number>> = {
  MXN: 1,
  USD: 18.5,
  EUR: 20,
  GBP: 23.5,
  CAD: 13.5,
  AUD: 12,
};

/** One point per full 10 MXN of a payment. */
export const MXN_PER_POINT = 10;

/** Flat bonus for each delivered and paid order. */
export const ORDER_BONUS_POINTS = 250;

export const LEVELS = ["Bronce", "Plata", "Oro"] as const;
export type Level = (typeof LEVELS)[number];

/** Lower bound of each level in MXN cents of 12 month spend. */
export const LEVEL_MIN_SPEND_CENTS: Readonly<Record<Level, number>> = {
  Bronce: 0,
  Plata: 15_000_000,
  Oro: 40_000_001,
};

/** Days without activity that make a customer "at risk". */
export const RISK_INACTIVE_DAYS = 90;

/** Inclusive window, in days after the cutoff, for upcoming birthdays. */
export const BIRTHDAY_WINDOW_DAYS = 7;

/** Length of the spend window used for the level, in days before the cutoff. */
export const SPEND_WINDOW_DAYS = 365;

/**
 * Fixed permission catalogue. Roles are editable rows in the database, but the
 * set of permissions they can hold is defined here in code, as required.
 */
export const PERMISSIONS = [
  "dashboard:view",
  "customers:read",
  "customers:amounts",
  "lists:view",
  "reports:export",
  "rewards:manage",
  "redemptions:manage",
  "portal-access:generate",
  "sync:run",
  "users:manage",
  "roles:manage",
  "tokens:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Human readable labels used by the roles screen. */
export const PERMISSION_LABELS: Readonly<Record<Permission, string>> = {
  "dashboard:view": "View dashboard summary",
  "customers:read": "Search customers and see points, level and history",
  "customers:amounts": "View money amounts (MXN spend, orders and payments)",
  "lists:view": "View at-risk and birthday lists",
  "reports:export": "Export reports (CSV)",
  "rewards:manage": "Manage the rewards catalogue",
  "redemptions:manage": "Manage redemptions (deliver, apply coupon, cancel)",
  "portal-access:generate": "Generate or reset a customer portal access",
  "sync:run": "Run the source synchronisation",
  "users:manage": "Manage internal users",
  "roles:manage": "Manage roles and permissions",
  "tokens:manage": "Manage API tokens",
};

/**
 * The three initial roles and their default permissions, copied from the
 * requirements table. They are inserted by the seed script only, so editing a
 * role in the panel is a normal database update and never overwrites the preset.
 */
export const ROLE_PRESETS: Readonly<
  Record<string, { description: string; permissions: Permission[] }>
> = {
  Administrator: {
    description: "Full access to every screen and action.",
    permissions: [...PERMISSIONS],
  },
  Manager: {
    description: "Runs the programme and the catalogue, but not the accounts.",
    permissions: [
      "dashboard:view",
      "customers:read",
      "customers:amounts",
      "lists:view",
      "reports:export",
      "rewards:manage",
      "redemptions:manage",
      "portal-access:generate",
    ],
  },
  "Customer Support": {
    description: "Helps customers without seeing money amounts.",
    permissions: [
      "dashboard:view",
      "customers:read",
      "lists:view",
      "redemptions:manage",
      "portal-access:generate",
    ],
  },
};

/** Internal session lifetime and cookie names. */
export const STAFF_COOKIE = "loyalty_staff_session";
export const CLIENT_COOKIE = "loyalty_client_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 8;
export const CLIENT_SESSION_TTL_MS = 1000 * 60 * 60 * 4;

/** Source API base URL. Read on the server only. */
export const SOURCE_API_BASE =
  process.env.FAKEAPI_BASE_URL ?? "https://fakeapi.dev/api/v1";

/** Page size allowed by the source API. Larger values are rejected upstream. */
export const SOURCE_PAGE_SIZE = 100;

/** Hard ceiling so a misbehaving API cannot keep one function running forever. */
export const SOURCE_MAX_PAGES = 60;
