import {
  BIRTHDAY_WINDOW_DAYS,
  CUTOFF_DATE,
  CURRENCY_RATES_TO_MXN,
  LEVEL_MIN_SPEND_CENTS,
  LEVELS,
  MEXICO_UTC_OFFSET_MINUTES,
  MXN_PER_POINT,
  ORDER_BONUS_POINTS,
  RISK_INACTIVE_DAYS,
  SPEND_WINDOW_DAYS,
  type Level,
} from "./constants";

/**
 * Pure loyalty rules.
 *
 * Nothing in this module touches the database or the network, which is what makes
 * the rules verifiable in isolation and reusable from both the sync job and the
 * API. Every function is deterministic for a given input plus the fixed cutoff.
 */

export type MovementType =
  | "pago"
  | "reembolso"
  | "bono_orden_entregada"
  | "canje"
  | "devolucion";

export type LedgerEntry = {
  date: string;
  type: MovementType;
  reference: string;
  points: number;
};

export type LoyaltyPayment = {
  id: number;
  amountCents: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string | null;
};

export type LoyaltyOrder = {
  id: number;
  status: string;
  paymentStatus: string;
  createdAt: string | null;
};

export type LoyaltySnapshot = {
  movements: LedgerEntry[];
  pointsEarned: number;
  spendCents: number;
  level: Level;
  lastActivityOn: string | null;
  daysInactive: number | null;
  atRisk: boolean;
};

const DAY_MS = 86_400_000;

/** Milliseconds for a calendar date at midnight UTC, used only for arithmetic. */
function dateToMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/** Shift a calendar date by a number of days, returning another calendar date. */
export function addDays(date: string, days: number): string {
  return new Date(dateToMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days between two calendar dates (later minus earlier). */
export function differenceInDays(later: string, earlier: string): number {
  return Math.round((dateToMs(later) - dateToMs(earlier)) / DAY_MS);
}

/** True when the value is a valid "YYYY-MM-DD" calendar date. */
export function isCalendarDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return !Number.isNaN(dateToMs(value));
}

/**
 * Convert a UTC timestamp from the source API into the Mexico calendar date.
 *
 * The rules are date based, so the offset is applied before slicing the day. A
 * payment made at 2026-05-01T03:00Z is still 2026-04-30 in Mexico and therefore
 * inside the cutoff.
 */
export function toMexicoDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const shifted = new Date(parsed.getTime() + MEXICO_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Convert an amount to MXN cents using the fixed rate table.
 *
 * Returns null for an unsupported currency so the caller can ignore the payment
 * instead of inventing a rate.
 */
export function convertToMxnCents(amount: unknown, currency: unknown): number | null {
  const numeric = typeof amount === "string" ? Number.parseFloat(amount) : Number(amount);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const code = String(currency ?? "").trim().toUpperCase();
  const rate = CURRENCY_RATES_TO_MXN[code];
  if (rate === undefined) {
    return null;
  }
  // Round to cents once, so points are computed from the published MXN value.
  return Math.round(numeric * rate * 100);
}

/** One point per full 10 MXN, floored per payment as the specification requires. */
export function pointsForPayment(mxnCents: number): number {
  return Math.floor(mxnCents / (MXN_PER_POINT * 100));
}

/** Level from the 12 month spend in MXN cents. */
export function levelForSpend(spendCents: number): Level {
  if (spendCents >= LEVEL_MIN_SPEND_CENTS.Oro) {
    return "Oro";
  }
  if (spendCents >= LEVEL_MIN_SPEND_CENTS.Plata) {
    return "Plata";
  }
  return "Bronce";
}

/**
 * Progress toward the next level. The Oro threshold is exclusive, so the amount
 * still needed is one cent more than 400,000 MXN minus the current spend.
 */
export function nextLevelProgress(spendCents: number): {
  nextLevel: Level | null;
  centsRemaining: number;
} {
  const level = levelForSpend(spendCents);
  if (level === "Oro") {
    return { nextLevel: null, centsRemaining: 0 };
  }
  const target = level === "Bronce" ? LEVEL_MIN_SPEND_CENTS.Plata : LEVEL_MIN_SPEND_CENTS.Oro;
  return { nextLevel: level === "Bronce" ? "Plata" : "Oro", centsRemaining: Math.max(0, target - spendCents) };
}

/** Position in LEVELS, used to compare a customer against a reward requirement. */
export function levelRank(level: string): number {
  const index = LEVELS.indexOf(level as Level);
  return index === -1 ? 0 : index;
}

/** True when `level` is at least `minimum`. */
export function meetsMinimumLevel(level: string, minimum: string): boolean {
  return levelRank(level) >= levelRank(minimum);
}

/** Show money for the UI: 123456 cents becomes "1,234.56". */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Compute points, spend, level, activity and risk for one customer.
 *
 * Rules applied, all against CUTOFF_DATE:
 * - succeeded payments earn floor(MXN / 10) points;
 * - refunded payments earn the same points and then lose them, netting zero;
 * - failed, disputed and every other status earn nothing;
 * - delivered and paid orders earn a flat bonus;
 * - spend for the level sums succeeded payments inside the 365 day window;
 * - activity is any succeeded payment or any order that is not cancelled.
 */
export function computeLoyalty(
  input: { payments: LoyaltyPayment[]; orders: LoyaltyOrder[] },
  cutoff: string = CUTOFF_DATE,
): LoyaltySnapshot {
  const movements: LedgerEntry[] = [];
  const spendWindowStart = addDays(cutoff, -SPEND_WINDOW_DAYS);

  let pointsEarned = 0;
  let spendCents = 0;
  let sawSucceededPayment = false;
  const activityDates: string[] = [];
  const activityTimes: string[] = [];

  for (const payment of input.payments) {
    const status = payment.status.trim().toLowerCase();
    if (status !== "succeeded" && status !== "refunded") {
      continue;
    }
    const localDate = toMexicoDate(payment.paidAt ?? payment.createdAt);
    if (!localDate || localDate > cutoff) {
      continue;
    }
    const mxnCents = convertToMxnCents(payment.amountCents / 100, payment.currency);
    if (mxnCents === null) {
      continue;
    }
    const points = pointsForPayment(mxnCents);

    if (status === "succeeded") {
      sawSucceededPayment = true;
      pointsEarned += points;
      movements.push({ date: localDate, type: "pago", reference: `pago:${payment.id}`, points });
      if (localDate > spendWindowStart) {
        spendCents += mxnCents;
      }
      activityDates.push(localDate);
      activityTimes.push(payment.paidAt ?? payment.createdAt ?? "");
    }

    if (status === "refunded") {
      // Both rows are kept so the history shows the refund explicitly, even
      // though the pair nets to zero.
      movements.push({ date: localDate, type: "pago", reference: `pago:${payment.id}`, points });
      movements.push({
        date: localDate,
        type: "reembolso",
        reference: `pago:${payment.id}`,
        points: -points,
      });
    }
  }

  for (const order of input.orders) {
    const localDate = toMexicoDate(order.createdAt);
    if (!localDate || localDate > cutoff) {
      continue;
    }
    const status = order.status.trim().toLowerCase();
    const paymentStatus = order.paymentStatus.trim().toLowerCase();

    if (status !== "cancelled") {
      activityDates.push(localDate);
      activityTimes.push(order.createdAt ?? "");
    }

    if (status === "delivered" && paymentStatus === "paid") {
      pointsEarned += ORDER_BONUS_POINTS;
      movements.push({
        date: localDate,
        type: "bono_orden_entregada",
        reference: `orden:${order.id}`,
        points: ORDER_BONUS_POINTS,
      });
    }
  }

  // A stable order keeps the ledger and the API response reproducible.
  movements.sort((a, b) =>
    a.date === b.date
      ? a.reference === b.reference
        ? a.type.localeCompare(b.type)
        : a.reference.localeCompare(b.reference)
      : a.date.localeCompare(b.date),
  );

  let lastActivityOn: string | null = null;
  for (const date of activityDates) {
    if (!lastActivityOn || date > lastActivityOn) {
      lastActivityOn = date;
    }
  }

  const daysInactive = lastActivityOn ? differenceInDays(cutoff, lastActivityOn) : null;

  return {
    movements,
    pointsEarned,
    spendCents,
    level: levelForSpend(spendCents),
    lastActivityOn,
    daysInactive,
    atRisk:
      sawSucceededPayment && daysInactive !== null && daysInactive >= RISK_INACTIVE_DAYS,
  };
}

/**
 * Birthday date inside the window that starts at the cutoff, or null.
 *
 * The day and month come from the first 10 characters of `dob` without any
 * timezone conversion, because a birthday is a calendar fact and not an instant.
 */
export function upcomingBirthday(
  dob: string | null | undefined,
  cutoff: string = CUTOFF_DATE,
): string | null {
  if (!dob || dob.length < 10) {
    return null;
  }
  const calendar = dob.slice(0, 10);
  if (!isCalendarDate(calendar)) {
    return null;
  }
  const monthDay = calendar.slice(5);
  for (let offset = 0; offset <= BIRTHDAY_WINDOW_DAYS; offset += 1) {
    const candidate = addDays(cutoff, offset);
    if (candidate.slice(5) === monthDay) {
      return candidate;
    }
  }
  return null;
}

/** Days remaining before a coupon expires, floored at zero for the UI. */
export function daysUntil(isoDate: string, now: Date = new Date()): number {
  const diff = Math.ceil((new Date(isoDate).getTime() - now.getTime()) / DAY_MS);
  return Math.max(0, diff);
}
