import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, EmptyRow, LevelBadge, PageHeader, Stat, TableRegion } from "@/components/ui";
import { hasPermission, requirePermission } from "@/lib/auth";
import { getCustomerDetail } from "@/lib/queries";
import { formatCents } from "@/lib/loyalty";

/**
 * Customer detail.
 *
 * Shows the points history exactly as it will be returned by the public API, plus
 * the portal access controls. The "generate access" button posts to a route
 * handler because the temporary password must be shown once and never stored in
 * clear text or in a URL the browser keeps.
 */
export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requirePermission("customers:read");
  const { id } = await params;
  const { error } = await searchParams;
  const customerId = Number(id);

  if (!Number.isInteger(customerId) || customerId <= 0) {
    notFound();
  }

  const detail = await getCustomerDetail(customerId);
  if (!detail) {
    notFound();
  }

  const showAmounts = hasPermission(session, "customers:amounts");
  const canGenerateAccess = hasPermission(session, "portal-access:generate");
  const progressPercent =
    detail.metrics.level === "Oro" || detail.metrics.progress.centsRemaining === 0
      ? 100
      : Math.min(
          100,
          Math.round(
            (detail.metrics.spendCents / (detail.metrics.spendCents + detail.metrics.progress.centsRemaining)) * 100,
          ),
        );

  return (
    <>
      <PageHeader
        title={detail.customer.name}
        description={`Customer #${detail.customer.id}${detail.customer.email ? ` · ${detail.customer.email}` : ""}`}
        actions={
          <Link href="/admin/customers" className="button button-small">
            Back to customers
          </Link>
        }
      />

      {error ? (
        <div style={{ marginBlockEnd: "1rem" }}>
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      <section className="grid" aria-label="Customer loyalty data">
        <Stat label="Points earned" value={detail.metrics.pointsEarned.toLocaleString("en-US")} />
        <Stat
          label="Points available"
          value={detail.metrics.pointsAvailable.toLocaleString("en-US")}
          hint="After redemptions"
        />
        <div className="card stat">
          <span className="muted">Level</span>
          <LevelBadge level={detail.metrics.level} />
          <span className="muted">
            {detail.metrics.progress.nextLevel
              ? `$${formatCents(detail.metrics.progress.centsRemaining)} to ${detail.metrics.progress.nextLevel}`
              : "Highest level reached"}
          </span>
        </div>
        {showAmounts ? (
          <Stat
            label="Spend (12m MXN)"
            value={`$${formatCents(detail.metrics.spendCents)}`}
            hint={`${detail.paymentCount} payments · ${detail.orderCount} orders`}
          />
        ) : null}
        <Stat
          label="Days without activity"
          value={detail.metrics.daysInactive ?? "No activity"}
          hint={detail.metrics.atRisk ? "At risk" : "Active"}
        />
      </section>

      <section className="card" style={{ marginBlockStart: "1rem" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2>Portal access</h2>
            <p className="muted">
              {detail.account?.hasPassword
                ? `Access is active for ${detail.account.email}.`
                : "This customer has no password yet and cannot sign in."}
            </p>
            {detail.account?.mustChangePassword ? (
              <p className="muted">The customer must change the temporary password at the next sign in.</p>
            ) : null}
          </div>
          {canGenerateAccess ? (
            <form action={`/api/staff/customers/${detail.customer.id}/access`} method="post">
              <button type="submit" className="button button-primary button-small">
                {detail.account?.hasPassword ? "Reset access" : "Generate access"}
              </button>
            </form>
          ) : null}
        </div>
      </section>

      <section className="card" style={{ marginBlockStart: "1rem" }}>
        <h2>Progress to the next level</h2>
        <p className="muted" style={{ marginBlockEnd: "0.5rem" }}>
          {detail.metrics.progress.nextLevel
            ? `${progressPercent}% of the way to ${detail.metrics.progress.nextLevel}`
            : "Oro is the highest level."}
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progress toward the next level"
        >
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      </section>

      <section className="stack" style={{ marginBlockStart: "1.5rem" }}>
        <h2>Points history</h2>
        <TableRegion label="Points movements for this customer">
          <table className="data-table">
            <caption>Latest 100 movements, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col">Reference</th>
                <th scope="col" className="num">
                  Points
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.movements.length === 0 ? (
                <EmptyRow colSpan={4}>No movements recorded for this customer.</EmptyRow>
              ) : (
                detail.movements.map((movement) => (
                  <tr key={`${movement.type}-${movement.reference}`}>
                    <th scope="row">{movement.date}</th>
                    <td data-label="Type">{movement.type.replaceAll("_", " ")}</td>
                    <td data-label="Reference" style={{ fontFamily: "var(--font-geist-mono)" }}>
                      {movement.reference}
                    </td>
                    <td data-label="Points" className="num">
                      {movement.points > 0 ? "+" : ""}
                      {movement.points.toLocaleString("en-US")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableRegion>
      </section>

      <p className="muted" style={{ marginBlockStart: "1rem" }}>
        Birthday: {detail.customer.dob ?? "not provided"} · Last source sync:{" "}
        {detail.customer.syncedAt.toISOString().slice(0, 10)}
      </p>
    </>
  );
}
