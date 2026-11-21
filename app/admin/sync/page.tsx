import { Alert, EmptyRow, PageHeader, StatusBadge, TableRegion } from "@/components/ui";
import { runSyncAction } from "@/app/actions/admin";
import { CUTOFF_DATE, SOURCE_API_BASE } from "@/lib/constants";
import { requirePermission } from "@/lib/auth";
import { listSyncRuns } from "@/lib/queries";

/**
 * Synchronisation screen.
 *
 * Staff with the permission can start a run on demand. The same job runs daily
 * through Vercel Cron, protected by CRON_SECRET, and every run is logged here with
 * its request count, record count and result.
 */
export default async function SyncPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("sync:run");
  const { ok, error } = await searchParams;
  const runs = await listSyncRuns();

  return (
    <>
      <PageHeader
        title="Synchronisation"
        description={`Downloads customers, orders and payments from ${SOURCE_API_BASE} and recalculates every customer as of ${CUTOFF_DATE}.`}
        actions={
          <form action={runSyncAction}>
            <button type="submit" className="button button-primary">
              Run synchronisation now
            </button>
          </form>
        }
      />

      {ok ? <Alert kind="success">{ok}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <section className="card stack" style={{ marginBlock: "1rem", gap: "0.4rem" }}>
        <h2>How the daily run works</h2>
        <p className="muted">
          Vercel Cron calls <code>/api/cron/sync</code> once a day with
          <code> Authorization: Bearer $CRON_SECRET</code>. The endpoint rejects every other caller.
          The job pages with <code>per_page=100</code>, retries a 429 after the advertised delay and
          stops after a fixed page ceiling.
        </p>
        <p className="muted">
          Derived point movements are rebuilt on each run inside a transaction, so running the job
          twice never duplicates points. Redemptions and their coupons are never touched by a sync.
        </p>
      </section>

      <TableRegion label="Synchronisation history">
        <table className="data-table">
          <caption>Latest {runs.length} runs</caption>
          <thead>
            <tr>
              <th scope="col">Started</th>
              <th scope="col">Trigger</th>
              <th scope="col" className="num">
                Requests
              </th>
              <th scope="col" className="num">
                Records
              </th>
              <th scope="col">Status</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <EmptyRow colSpan={6}>No run recorded yet.</EmptyRow>
            ) : (
              runs.map((run) => (
                <tr key={run.id}>
                  <th scope="row">
                    {run.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                    <div className="muted">
                      {run.finishedAt
                        ? `${Math.max(
                            0,
                            Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000),
                          )}s`
                        : "in progress"}
                    </div>
                  </th>
                  <td data-label="Trigger">
                    {run.trigger}
                    {run.triggeredBy ? <div className="muted">{run.triggeredBy}</div> : null}
                  </td>
                  <td data-label="Requests" className="num">
                    {run.requests}
                  </td>
                  <td data-label="Records" className="num">
                    {run.records}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={run.status} />
                  </td>
                  <td data-label="Result">{run.message || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableRegion>
    </>
  );
}
