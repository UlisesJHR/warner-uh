import { randomBytes } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { CUTOFF_DATE, LEVELS, type Level } from "./constants";
import { levelForSpend, meetsMinimumLevel } from "./loyalty";
import {
  coupons,
  customerMetrics,
  pointMovements,
  redemptions,
  rewards,
} from "./db/schema";
import type { Database } from "./db";

/**
 * Redemption writes.
 *
 * Everything here runs inside a serializable transaction with a bounded retry,
 * because two customers may try to take the last unit at the same time. The stock
 * decrement is a conditional UPDATE, so the database itself refuses to oversell.
 */

export type RedeemResult =
  | { ok: true; redemptionId: string; code: string | null }
  | { ok: false; error: string };

export type RedemptionResult = { ok: true } | { ok: false; error: string };

/** Sum of every ledger entry, which is the points the customer can spend. */
export async function getAvailablePoints(db: Database, customerId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${pointMovements.points}), 0)` })
    .from(pointMovements)
    .where(eq(pointMovements.customerId, customerId));
  return Number(row?.total ?? 0);
}

/** Points earned from source activity only, without subtracting redemptions. */
export async function getEarnedPoints(db: Database, customerId: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${pointMovements.points}), 0)` })
    .from(pointMovements)
    .where(
      and(
        eq(pointMovements.customerId, customerId),
        sql`${pointMovements.type} in ('pago', 'reembolso', 'bono_orden_entregada')`,
      ),
    );
  return Number(row?.total ?? 0);
}

/** Level for a customer, recomputed from stored spend so it never goes stale. */
export async function getCustomerLevel(db: Database, customerId: number): Promise<Level> {
  const [row] = await db
    .select({ spendCents: customerMetrics.spendCents })
    .from(customerMetrics)
    .where(eq(customerMetrics.customerId, customerId))
    .limit(1);
  return row ? levelForSpend(row.spendCents) : "Bronce";
}

/** Human readable coupon code, for example LEAL-7Q4K-92XM. */
function generateCouponCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let body = "";
  for (let index = 0; index < bytes.length; index += 1) {
    body += alphabet[bytes[index] % alphabet.length];
  }
  return `LEAL-${body.slice(0, 4)}-${body.slice(4)}`;
}

/** True for Postgres serialization and deadlock errors, which are safe to retry. */
function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "40001" || code === "40P01") {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("could not serialize") || message.includes("deadlock detected");
}

/**
 * Run a transaction at serializable isolation and retry serialization failures.
 *
 * Without the retry a concurrent redemption would surface a raw database error;
 * with it the second request re-runs, sees the updated stock and gets a clear
 * "out of stock" answer.
 */
async function serializable<T>(db: Database, work: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await db.transaction(work, { isolationLevel: "serializable" });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) {
        throw error;
      }
    }
  }
  throw lastError ?? new Error("The transaction could not be completed");
}

/**
 * Redeem one reward for one customer.
 *
 * Validations are all evaluated inside the transaction: reward active, stock,
 * minimum level, per customer limit and available points. The stock decrement,
 * the negative movement and the redemption row commit together or not at all.
 */
export async function redeemReward(
  db: Database,
  input: { customerId: number; rewardId: string },
): Promise<RedeemResult> {
  try {
    return await serializable(db, async (tx) => {
      const [reward] = await tx
        .select()
        .from(rewards)
        .where(eq(rewards.id, input.rewardId))
        .limit(1);

      if (!reward) {
        return { ok: false, error: "This reward no longer exists." };
      }
      if (!reward.active) {
        return { ok: false, error: "This reward is not available right now." };
      }

      // The transaction handle exposes the same query builder as the database,
      // so the balance and level reads below run inside this transaction.
      const level = await getCustomerLevel(tx as unknown as Database, input.customerId);
      if (!meetsMinimumLevel(level, reward.minLevel)) {
        const minimum = LEVELS.includes(reward.minLevel as Level) ? reward.minLevel : "Bronce";
        return { ok: false, error: `This reward needs the ${minimum} level. Your level is ${level}.` };
      }

      const available = await getAvailablePoints(tx as unknown as Database, input.customerId);
      if (available < reward.pointsCost) {
        return {
          ok: false,
          error: `You need ${reward.pointsCost - available} more points for this reward.`,
        };
      }

      if (reward.perCustomerLimit !== null) {
        const [countRow] = await tx
          .select({ total: sql<string>`count(*)` })
          .from(redemptions)
          .where(
            and(
              eq(redemptions.customerId, input.customerId),
              eq(redemptions.rewardId, reward.id),
              ne(redemptions.status, "cancelled"),
            ),
          );
        if (Number(countRow?.total ?? 0) >= reward.perCustomerLimit) {
          return {
            ok: false,
            error: `You already reached the limit of ${reward.perCustomerLimit} for this reward.`,
          };
        }
      }

      if (reward.stock !== null) {
        const updated = await tx
          .update(rewards)
          .set({ stock: sql`${rewards.stock} - 1`, updatedAt: new Date() })
          .where(and(eq(rewards.id, reward.id), sql`${rewards.stock} > 0`))
          .returning({ id: rewards.id });
        if (updated.length === 0) {
          return { ok: false, error: "This reward just went out of stock." };
        }
      }

      const [redemption] = await tx
        .insert(redemptions)
        .values({
          customerId: input.customerId,
          rewardId: reward.id,
          rewardName: reward.name,
          pointsCost: reward.pointsCost,
          status: "pending",
        })
        .returning({ id: redemptions.id });

      await tx.insert(pointMovements).values({
        customerId: input.customerId,
        type: "canje",
        reference: `canje:${redemption.id}`,
        points: -reward.pointsCost,
        occurredOn: CUTOFF_DATE,
      });

      let code: string | null = null;
      if (reward.kind === "discount") {
        for (let attempt = 0; attempt < 5 && !code; attempt += 1) {
          const candidate = generateCouponCode();
          try {
            await tx.insert(coupons).values({
              code: candidate,
              redemptionId: redemption.id,
              customerId: input.customerId,
              discountType: reward.discountType ?? "amount",
              valueCents: reward.discountValueCents ?? 0,
              minPurchaseCents: reward.minPurchaseCents,
              expiresAt: new Date(Date.now() + (reward.validDays ?? 30) * 86_400_000),
            });
            code = candidate;
          } catch {
            // A duplicate code is astronomically unlikely, but the loop keeps the
            // transaction alive instead of failing the redemption.
          }
        }
        if (!code) {
          return { ok: false, error: "A coupon could not be generated. Please try again." };
        }
      }

      return { ok: true, redemptionId: redemption.id, code };
    });
  } catch {
    return { ok: false, error: "The redemption could not be completed. Please try again." };
  }
}

/** Mark a pending redemption as delivered. */
export async function deliverRedemption(db: Database, redemptionId: string): Promise<RedemptionResult> {
  const updated = await db
    .update(redemptions)
    .set({ status: "delivered", deliveredAt: new Date() })
    .where(and(eq(redemptions.id, redemptionId), eq(redemptions.status, "pending")))
    .returning({ id: redemptions.id });
  return updated.length > 0
    ? { ok: true }
    : { ok: false, error: "Only a pending redemption can be delivered." };
}

/**
 * Cancel a redemption, return its stock and refund its points.
 *
 * The refund is a positive "devolucion" movement, so the ledger keeps both the
 * spend and the return instead of erasing history.
 */
export async function cancelRedemption(db: Database, redemptionId: string): Promise<RedemptionResult> {
  try {
    return await serializable(db, async (tx) => {
      const [redemption] = await tx
        .select()
        .from(redemptions)
        .where(eq(redemptions.id, redemptionId))
        .limit(1);
      if (!redemption) {
        return { ok: false, error: "Redemption not found." };
      }
      if (redemption.status === "cancelled") {
        return { ok: false, error: "This redemption is already cancelled." };
      }

      await tx
        .update(redemptions)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(redemptions.id, redemptionId));

      await tx
        .update(rewards)
        .set({ stock: sql`${rewards.stock} + 1`, updatedAt: new Date() })
        .where(and(eq(rewards.id, redemption.rewardId), sql`${rewards.stock} is not null`));

      await tx
        .insert(pointMovements)
        .values({
          customerId: redemption.customerId,
          type: "devolucion",
          reference: `canje:${redemption.id}`,
          points: redemption.pointsCost,
          occurredOn: CUTOFF_DATE,
        })
        .onConflictDoNothing();

      await tx
        .update(coupons)
        .set({ status: "cancelled" })
        .where(eq(coupons.redemptionId, redemption.id));

      return { ok: true };
    });
  } catch {
    return { ok: false, error: "The cancellation could not be completed." };
  }
}
