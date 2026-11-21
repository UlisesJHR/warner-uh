import Link from "next/link";
import { Alert, EmptyRow, LevelBadge, Money, PageHeader, Stat, TableRegion } from "@/components/ui";
import { hasPermission, requirePermission } from "@/lib/auth";
import { getDashboardSummary } from "@/lib/queries";
import { formatCents } from "@/lib/loyalty";

/**
 * Dashboard.
 *
 * Aggregates come from the cached metrics table, so the screen reflects the last
 * synchronisation rather than calling the source API on every visit.
 */
export default async function DashboardPage() {
  const session = await requirePermission("dashboard:view");
  const summary = await getDashboardSummary();
  const showAmounts = hasPermission(session, "customers:amounts");

  return (
    <>
      <PageHeader
        title="Loyalty overview"
        description="Every figure is calculated as of 30 April 2026, the programme cutoff date."
        actions={
          showAmounts ? (
            <Link href="/admin/export" className="button button-small">
              Export customers (CSV)
            </Link>
          ) : null
        }
      />

      {!summary.lastSync ? (
        <div style={{ marginBlockEnd: "1rem" }}>
          <Alert kind="error">
            No synchronisation has run yet. Open{" "}
            <Link href="/admin/sync">Synchronisation</Link> to import customers, orders and
            payments.
          </Alert>
        </div>
      ) : null}

      <section className="grid" aria-label="Headline numbers">
        <Stat
          label="Customers"
          value={summary.totalCustomers}
          hint="Portal accounts created by the sync"
        />
        <Stat
          label="Points earned"
          value={summary.totalPoints.toLocaleString("en-US")}
          hint="Before redemptions"
        />
        <Stat label="At risk" value={summary.atRisk} hint="90 days or more without activity" />
        <Stat label="Birthdays in the next 7 days" value={summary.birthdays} />
      </section>

      <section className="grid" aria-label="Customers by level" style={{ marginBlockStart: "1rem" }}>
        {summary.byLevel.map((entry) => (
          <div key={entry.level} className="card stat">
            <LevelBadge level={entry.level} />
            <span className="stat-value">{entry.count}</span>
            <span className="muted">customers</span>
          </div>
        ))}
      </section>

      <section className="stack" style={{ marginBlockStart: "1.5rem" }}>
        <h2>Top 10 customers by points</h2>
        <TableRegion label="Top ten customers by points earned">
          <table className="data-table">
            <caption>Points earned from payments and delivered orders</caption>
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Level</th>
                <th scope="col" className="num">
                  Points
                </th>
                {showAmounts ? (
                  <th scope="col" className="num">
                    Spend (12m MXN)
                  </th>
                ) : null}
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.topCustomers.length === 0 ? (
                <EmptyRow colSpan={showAmounts ? 5 : 4}>
                  No customers yet. Run a synchronisation to import them.
                </EmptyRow>
              ) : (
                summary.topCustomers.map((customer) => (
                  <tr key={customer.id}>
                    <th scope="row">
                      <Link href={`/admin/customers/${customer.id}`}>{customer.name}</Link>
                      <div className="muted">#{customer.id}</div>
                    </th>
                    <td data-label="Level">
                      <LevelBadge level={customer.level} />
                    </td>
                    <td data-label="Points" className="num">
                      {customer.pointsEarned.toLocaleString("en-US")}
                    </td>
                    {showAmounts ? (
                      <td data-label="Spend (12m MXN)" className="num">
                        ${formatCents(customer.spendCents)}
                      </td>
                    ) : null}
                    <td data-label="Status">
                      {customer.atRisk ? (
                        <span className="badge badge-danger">At risk</span>
                      ) : (
                        <span className="badge">Active</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableRegion>
      </section>

      {summary.lastSync ? (
        <section className="stack" style={{ marginBlockStart: "1.5rem" }}>
          <h2>Last synchronisation</h2>
          <div className="card stack" style={{ gap: "0.35rem" }}>
            <p>
              Status: <strong>{summary.lastSync.status}</strong>
            </p>
            <p className="muted">
              Started {summary.lastSync.startedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
              {summary.lastSync.finishedAt
                ? `, finished ${summary.lastSync.finishedAt.toISOString().replace("T", " ").slice(0, 19)} UTC`
                : ""}
            </p>
            <p className="muted">{summary.lastSync.message || "No details recorded."}</p>
          </div>
        </section>
      ) : null}

      <p className="muted" style={{ marginBlockStart: "1.5rem" }}>
        Totals shown as <Money cents={0} /> style values use MXN. The 12 month spend window runs
        from 30 April 2025 to 30 April 2026 inclusive.
      </p>
    </>
  );
}
