import Link from "next/link";
import { Alert, EmptyRow, PageHeader, StatusBadge, TableRegion } from "@/components/ui";
import { cancelRedemptionAction, deliverRedemptionAction } from "@/app/actions/admin";
import { requirePermission } from "@/lib/auth";
import { listRedemptions } from "@/lib/queries";

/**
 * Redemption queue.
 *
 * Staff mark a pending redemption as delivered, or cancel it. Cancelling returns
 * the stock and the points through a positive ledger movement, so the history
 * keeps both entries.
 */
export default async function RedemptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; ok?: string; error?: string }>;
}) {
  await requirePermission("redemptions:manage");
  const { status, ok, error } = await searchParams;
  const filter = status && status !== "all" ? status : undefined;
  const rows = await listRedemptions(filter);

  return (
    <>
      <PageHeader
        title="Redemptions"
        description="Products waiting for delivery and coupons issued to customers."
      />

      {ok ? <Alert kind="success">{ok}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <nav className="nav" aria-label="Filter redemptions by status" style={{ marginBlock: "1rem" }}>
        <Link href="/admin/redemptions">All</Link>
        <Link href="/admin/redemptions?status=pending">Pending</Link>
        <Link href="/admin/redemptions?status=delivered">Delivered</Link>
        <Link href="/admin/redemptions?status=cancelled">Cancelled</Link>
      </nav>

      <TableRegion label="Redemptions">
        <table className="data-table">
          <caption>
            {rows.length} redemption{rows.length === 1 ? "" : "s"}
            {filter ? ` with status ${filter}` : ""}
          </caption>
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Reward</th>
              <th scope="col" className="num">
                Points
              </th>
              <th scope="col">Coupon</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6}>No redemption matches this filter.</EmptyRow>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    <Link href={`/admin/customers/${row.customerId}`}>{row.customerName}</Link>
                    <div className="muted">{row.createdAt.toISOString().slice(0, 10)}</div>
                  </th>
                  <td data-label="Reward">{row.rewardName}</td>
                  <td data-label="Points" className="num">
                    {row.pointsCost.toLocaleString("en-US")}
                  </td>
                  <td data-label="Coupon">
                    {row.code ? (
                      <span>
                        <code>{row.code}</code> <StatusBadge status={row.couponStatus ?? "valid"} />
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={row.status} />
                  </td>
                  <td data-label="Actions">
                    <div className="row">
                      {row.status === "pending" ? (
                        <form action={deliverRedemptionAction} className="inline-form">
                          <input type="hidden" name="id" value={row.id} />
                          <button type="submit" className="button button-small">
                            Mark delivered
                          </button>
                        </form>
                      ) : null}
                      {row.status !== "cancelled" ? (
                        <form action={cancelRedemptionAction} className="inline-form">
                          <input type="hidden" name="id" value={row.id} />
                          <button type="submit" className="button button-small button-danger">
                            Cancel
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableRegion>
    </>
  );
}
