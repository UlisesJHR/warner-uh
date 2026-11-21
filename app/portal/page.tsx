import Link from "next/link";
import { Alert, EmptyRow, LevelBadge, PageHeader, Stat, TableRegion } from "@/components/ui";
import { requireReadyClientSession } from "@/lib/auth";
import { getPortalOverview } from "@/lib/queries";
import { formatCents } from "@/lib/loyalty";

/**
 * Customer overview.
 *
 * Reads only rows that belong to the signed-in customer: the id comes from the
 * session, never from the URL.
 */
export default async function PortalHomePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const session = await requireReadyClientSession();
  const overview = await getPortalOverview(session.customerId);
  const { ok } = await searchParams;

  if (!overview) {
    return <p>Your loyalty profile is not available yet. Contact the store.</p>;
  }

  const { metrics } = overview;
  const progressPercent =
    metrics.level === "Oro" || metrics.progress.centsRemaining === 0
      ? 100
      : Math.min(
          100,
          Math.round(
            (metrics.spendCents / (metrics.spendCents + metrics.progress.centsRemaining)) * 100,
          ),
        );

  return (
    <>
      <PageHeader title={`Hello, ${session.name.split(" ")[0]}`} description="Your loyalty account." />
      {ok ? <Alert kind="success">{ok}</Alert> : null}

      <section className="grid" aria-label="Your loyalty data">
        <Stat label="Points available" value={metrics.pointsAvailable.toLocaleString("en-US")} />
        <div className="card stat">
          <span className="muted">Your level</span>
          <LevelBadge level={metrics.level} />
          <span className="muted">
            {metrics.progress.nextLevel
              ? `$${formatCents(metrics.progress.centsRemaining)} more spend for ${metrics.progress.nextLevel}`
              : "You reached the top level"}
          </span>
        </div>
        <Stat
          label="Points earned all time"
          value={metrics.pointsEarned.toLocaleString("en-US")}
          hint="Before redemptions"
        />
      </section>

      <section className="card" style={{ marginBlockStart: "1rem" }}>
        <h2>Progress to the next level</h2>
        <p className="muted" style={{ marginBlockEnd: "0.5rem" }}>
          {metrics.progress.nextLevel
            ? `${progressPercent}% of the way to ${metrics.progress.nextLevel}`
            : "You already hold the highest level."}
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
        <p className="muted" style={{ marginBlockStart: "0.5rem" }}>
          Level is based on your spend in the 12 months up to 30 April 2026.
        </p>
      </section>

      <section className="stack" style={{ marginBlockStart: "1.5rem" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Recent movements</h2>
          <Link href="/portal/rewards" className="button button-small">
            Browse rewards
          </Link>
        </div>
        <TableRegion label="Your recent point movements">
          <table className="data-table">
            <caption>Latest 25 movements</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">
                  Points
                </th>
              </tr>
            </thead>
            <tbody>
              {overview.movements.length === 0 ? (
                <EmptyRow colSpan={3}>No movements yet.</EmptyRow>
              ) : (
                overview.movements.map((movement) => (
                  <tr key={`${movement.type}-${movement.reference}`}>
                    <th scope="row">{movement.date}</th>
                    <td data-label="Type">{movement.type.replaceAll("_", " ")}</td>
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
    </>
  );
}
