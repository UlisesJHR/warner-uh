import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createEmbeddedDatabase, type Database } from "../lib/db";
import {
  addDays,
  computeLoyalty,
  convertToMxnCents,
  levelForSpend,
  pointsForPayment,
  toMexicoDate,
  upcomingBirthday,
} from "../lib/loyalty";
import { cancelRedemption, getAvailablePoints, redeemReward } from "../lib/redeem";
import { recalculateLoyalty } from "../lib/sync";
import {
  customers,
  customerMetrics,
  orders,
  payments,
  pointMovements,
  redemptions,
  rewards,
} from "../lib/db/schema";

/**
 * Verification suite for the rules, the sync aggregation and the redemption
 * transaction. It runs against an in-memory PGlite database, so the same SQL and
 * the same constraints as production are exercised with no external service.
 */

let db: Database;
let close: () => Promise<void>;

before(async () => {
  const created = createEmbeddedDatabase();
  db = created.db;
  close = () => created.client.close();
  await migrate(db as never, { migrationsFolder: "./drizzle" });
});

after(async () => {
  await close();
});

test("converts currencies at the fixed rates and floors points per payment", () => {
  // 3,000 USD at 18.50 is 55,500 MXN, which floors to 5,550 points.
  assert.equal(convertToMxnCents(3000, "USD"), 5_550_000);
  assert.equal(pointsForPayment(5_550_000), 5550);
  // 9.99 MXN is below one full block of 10 MXN.
  assert.equal(pointsForPayment(999), 0);
  // An unsupported currency is ignored instead of being guessed.
  assert.equal(convertToMxnCents(100, "JPY"), null);
});

test("converts UTC timestamps to the Mexico calendar date", () => {
  assert.equal(toMexicoDate("2026-05-01T05:59:59.000Z"), "2026-04-30");
  assert.equal(toMexicoDate("2026-05-01T06:00:00.000Z"), "2026-05-01");
  assert.equal(toMexicoDate(null), null);
});

test("applies payments, refunds, bonuses and the cutoff date", () => {
  const snapshot = computeLoyalty({
    payments: [
      {
        id: 3220,
        amountCents: 5_547_000,
        currency: "MXN",
        status: "succeeded",
        paidAt: "2026-03-10T18:00:00.000Z",
        createdAt: "2026-03-09T18:00:00.000Z",
      },
      {
        id: 3221,
        amountCents: 100_000,
        currency: "MXN",
        status: "refunded",
        paidAt: "2026-03-11T18:00:00.000Z",
        createdAt: null,
      },
      {
        id: 3222,
        amountCents: 100_000,
        currency: "MXN",
        status: "failed",
        paidAt: "2026-03-12T18:00:00.000Z",
        createdAt: null,
      },
      {
        id: 3223,
        amountCents: 100_000,
        currency: "JPY",
        status: "succeeded",
        paidAt: "2026-03-13T18:00:00.000Z",
        createdAt: null,
      },
      {
        id: 3224,
        amountCents: 100_000,
        currency: "MXN",
        status: "succeeded",
        // 06:00Z on 1 May is 00:00 on 1 May in Mexico, so it is after the cutoff.
        paidAt: "2026-05-01T06:00:00.000Z",
        createdAt: null,
      },
    ],
    orders: [
      {
        id: 3047,
        status: "delivered",
        paymentStatus: "paid",
        createdAt: "2026-04-02T18:00:00.000Z",
      },
      {
        id: 3048,
        status: "delivered",
        paymentStatus: "pending",
        createdAt: "2026-04-03T18:00:00.000Z",
      },
      {
        id: 3049,
        status: "shipped",
        paymentStatus: "paid",
        createdAt: "2026-04-04T18:00:00.000Z",
      },
    ],
  });

  // 5,547 points from the succeeded payment plus the 250 point order bonus.
  assert.equal(snapshot.pointsEarned, 5547 + 250);
  assert.equal(snapshot.spendCents, 5_547_000);
  // 55,470 MXN of spend is below the 150,000 MXN Plata threshold.
  assert.equal(snapshot.level, "Bronce");

  const refundPair = snapshot.movements.filter((entry) => entry.reference === "pago:3221");
  assert.deepEqual(
    refundPair.map((entry) => [entry.type, entry.points]),
    [
      ["pago", 100],
      ["reembolso", -100],
    ],
  );
  assert.equal(
    refundPair.reduce((total, entry) => total + entry.points, 0),
    0,
  );
  assert.equal(snapshot.movements.some((entry) => entry.reference === "pago:3222"), false);
  assert.equal(snapshot.movements.some((entry) => entry.reference === "pago:3223"), false);
  assert.equal(snapshot.movements.some((entry) => entry.reference === "pago:3224"), false);
  assert.deepEqual(
    snapshot.movements
      .filter((entry) => entry.type === "bono_orden_entregada")
      .map((entry) => entry.reference),
    ["orden:3047"],
  );
});

test("uses 12 month spend for the level with the published thresholds", () => {
  assert.equal(levelForSpend(0), "Bronce");
  assert.equal(levelForSpend(14_999_999), "Bronce");
  assert.equal(levelForSpend(15_000_000), "Plata");
  assert.equal(levelForSpend(40_000_000), "Plata");
  assert.equal(levelForSpend(40_000_001), "Oro");

  const inWindow = computeLoyalty({
    payments: [
      {
        id: 1,
        amountCents: 15_000_000,
        currency: "MXN",
        status: "succeeded",
        paidAt: "2026-04-29T18:00:00.000Z",
        createdAt: null,
      },
    ],
    orders: [],
  });
  assert.equal(inWindow.spendCents, 15_000_000);
  assert.equal(inWindow.level, "Plata");

  // The window starts 365 days before the cutoff and excludes that first day.
  const outsideWindow = computeLoyalty({
    payments: [
      {
        id: 2,
        amountCents: 20_000_000,
        currency: "MXN",
        status: "succeeded",
        paidAt: `${addDays("2026-04-30", -365)}T18:00:00.000Z`,
        createdAt: null,
      },
    ],
    orders: [],
  });
  assert.equal(outsideWindow.spendCents, 0);
  assert.equal(outsideWindow.level, "Bronce");
  // The points themselves are not limited by the spend window.
  // 200,000 MXN is 20,000 points even though the payment falls outside the
  // spend window used for the level.
  assert.equal(outsideWindow.pointsEarned, 20_000);
});

test("flags a customer at risk after 90 days without activity", () => {
  const base = {
    amountCents: 100_000,
    currency: "MXN",
    status: "succeeded",
    createdAt: null,
  };
  const atRisk = computeLoyalty({
    payments: [{ id: 10, paidAt: "2026-01-20T18:00:00.000Z", ...base }],
    orders: [],
  });
  assert.equal(atRisk.daysInactive, 100);
  assert.equal(atRisk.atRisk, true);

  const stillActive = computeLoyalty({
    payments: [{ id: 11, paidAt: "2026-02-20T18:00:00.000Z", ...base }],
    orders: [],
  });
  assert.equal(stillActive.atRisk, false);

  // A non cancelled order counts as activity and stops the risk flag.
  const activeThroughOrder = computeLoyalty({
    payments: [{ id: 12, paidAt: "2026-01-20T18:00:00.000Z", ...base }],
    orders: [
      {
        id: 90,
        status: "shipped",
        paymentStatus: "pending",
        createdAt: "2026-04-10T18:00:00.000Z",
      },
    ],
  });
  assert.equal(activeThroughOrder.lastActivityOn, "2026-04-10");
  assert.equal(activeThroughOrder.atRisk, false);

  // No succeeded payment ever means the customer is not "at risk", just inactive.
  const neverPaid = computeLoyalty({ payments: [], orders: [] });
  assert.equal(neverPaid.daysInactive, null);
  assert.equal(neverPaid.atRisk, false);
});

test("matches birthdays inside the inclusive seven day window", () => {
  assert.equal(upcomingBirthday("1990-05-03"), "2026-05-03");
  assert.equal(upcomingBirthday("1985-04-30T00:00:00.000Z"), "2026-04-30");
  assert.equal(upcomingBirthday("1999-05-07"), "2026-05-07");
  assert.equal(upcomingBirthday("1999-05-08"), null);
  // The window can cross the new year.
  assert.equal(upcomingBirthday("1999-01-02", "2026-12-28"), "2027-01-02");
  assert.equal(upcomingBirthday(null), null);
});

test("aggregates stored rows and stays idempotent across sync runs", async () => {
  await db.insert(customers).values([
    { id: 241, name: "Ana Torres", email: "ana@example.test", dob: "1990-05-03" },
    { id: 192, name: "Beto Ruiz", email: "beto@example.test", dob: "1988-01-02" },
  ]);
  await db.insert(payments).values([
    {
      id: 3220,
      customerId: 241,
      amountCents: 5_547_000,
      currency: "MXN",
      status: "succeeded",
      amountMxnCents: 5_547_000,
      paidAt: new Date("2026-03-10T18:00:00.000Z"),
      sourceCreatedAt: new Date("2026-03-09T18:00:00.000Z"),
    },
    {
      id: 3300,
      customerId: 192,
      amountCents: 100_000,
      currency: "MXN",
      status: "succeeded",
      amountMxnCents: 100_000,
      paidAt: new Date("2026-01-20T18:00:00.000Z"),
      sourceCreatedAt: new Date("2026-01-20T18:00:00.000Z"),
    },
  ]);
  await db.insert(orders).values([
    {
      id: 3047,
      customerId: 241,
      status: "delivered",
      paymentStatus: "paid",
      totalCents: 250_000,
      currency: "MXN",
      sourceCreatedAt: new Date("2026-04-02T18:00:00.000Z"),
    },
  ]);

  await recalculateLoyalty(db);
  await recalculateLoyalty(db);

  const movements = await db.select().from(pointMovements);
  assert.equal(movements.length, 3);
  assert.equal(await getAvailablePoints(db, 241), 5547 + 250);

  const [metrics] = await db
    .select()
    .from(customerMetrics)
    .where(eq(customerMetrics.customerId, 241));
  // 55,470 MXN of 12 month spend stays in the entry level.
  assert.equal(metrics.level, "Bronce");
  assert.equal(metrics.spendCents, 5_547_000);
  assert.equal(metrics.atRisk, false);

  const [riskMetrics] = await db
    .select()
    .from(customerMetrics)
    .where(eq(customerMetrics.customerId, 192));
  assert.equal(riskMetrics.atRisk, true);
  assert.equal(riskMetrics.daysInactive, 100);
});

test("redeems atomically, enforces stock and refunds a cancellation", async () => {
  const [reward] = await db
    .insert(rewards)
    .values({
      name: "Last unit",
      kind: "product",
      pointsCost: 1000,
      stock: 1,
      minLevel: "Bronce",
    })
    .returning({ id: rewards.id });

  const first = await redeemReward(db, { customerId: 241, rewardId: reward.id });
  assert.equal(first.ok, true);

  // The same customer tries again: the balance is enough, only the stock is gone.
  const second = await redeemReward(db, { customerId: 241, rewardId: reward.id });
  assert.equal(second.ok, false);
  assert.match(second.ok ? "" : second.error, /out of stock/i);

  // 5,797 earned points minus the 1,000 spent above.
  assert.equal(await getAvailablePoints(db, 241), 5797 - 1000);

  const [redemption] = await db.select().from(redemptions);
  const cancelled = await cancelRedemption(db, redemption.id);
  assert.equal(cancelled.ok, true);
  assert.equal(await getAvailablePoints(db, 241), 5797);

  const [restored] = await db.select().from(rewards).where(eq(rewards.id, reward.id));
  assert.equal(restored.stock, 1);

  const refundEntries = await db
    .select()
    .from(pointMovements)
    .where(eq(pointMovements.type, "devolucion"));
  assert.equal(refundEntries.length, 1);
});

test("refuses a redemption above the customer balance", async () => {
  const [reward] = await db
    .insert(rewards)
    .values({ name: "Too expensive", kind: "product", pointsCost: 999_999, stock: null })
    .returning({ id: rewards.id });

  const result = await redeemReward(db, { customerId: 192, rewardId: reward.id });
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /more points/i);
});
