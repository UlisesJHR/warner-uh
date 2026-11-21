import { asc, eq, sql } from "drizzle-orm";
import { getStaffSession, hasPermission } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { clientAccounts, customers, customerMetrics, pointMovements } from "@/lib/db/schema";

/**
 * CSV export of every customer.
 *
 * Permissions are checked here as well as in the button, and the response is
 * marked as an attachment so the browser downloads it instead of rendering it.
 */
export async function GET(): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return new Response("Sign in to continue.", { status: 401 });
  }
  if (!hasPermission(session, "reports:export") || !hasPermission(session, "customers:amounts")) {
    return new Response("Your role cannot export this report.", { status: 403 });
  }

  const db = await getDb();
  const rows = await db
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      dob: customers.dob,
      level: sql<string>`coalesce(${customerMetrics.level}, 'Bronce')`,
      pointsEarned: sql<number>`coalesce(${customerMetrics.pointsEarned}, 0)`,
      spendCents: sql<number>`coalesce(${customerMetrics.spendCents}, 0)`,
      daysInactive: customerMetrics.daysInactive,
      atRisk: sql<boolean>`coalesce(${customerMetrics.atRisk}, false)`,
      hasAccess: sql<boolean>`${clientAccounts.passwordHash} is not null`,
      available: sql<number>`coalesce((
        select sum(${pointMovements.points})
        from ${pointMovements}
        where ${pointMovements.customerId} = ${customers.id}
      ), 0)`,
    })
    .from(customers)
    .leftJoin(customerMetrics, eq(customerMetrics.customerId, customers.id))
    .leftJoin(clientAccounts, eq(clientAccounts.customerId, customers.id))
    .orderBy(asc(customers.id))
    .limit(5000);

  const header = [
    "customer_id",
    "name",
    "email",
    "birthday",
    "level",
    "points_earned",
    "points_available",
    "spend_12m_mxn",
    "days_inactive",
    "at_risk",
    "portal_access",
  ];

  const lines = rows.map((row) =>
    [
      row.id,
      row.name,
      row.email,
      row.dob ?? "",
      row.level,
      row.pointsEarned,
      row.available,
      (row.spendCents / 100).toFixed(2),
      row.daysInactive ?? "",
      row.atRisk ? "yes" : "no",
      row.hasAccess ? "yes" : "no",
    ]
      .map(csvCell)
      .join(","),
  );

  const csv = [header.join(","), ...lines].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="loyalty-customers-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Quote a CSV cell and escape embedded quotes. */
function csvCell(value: string | number): string {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
