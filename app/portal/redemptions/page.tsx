import { Alert, EmptyRow, PageHeader, StatusBadge, TableRegion } from "@/components/ui";
import { requireReadyClientSession } from "@/lib/auth";
import { getPortalRedemptions } from "@/lib/queries";

/**
 * The customer's own redemptions and coupons.
 *
 * The query filters by the session customer id, so no request can return another
 * customer's history even if an id is changed in the URL.
 */
export default async function PortalRedemptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const session = await requireReadyClientSession();
  const { ok } = await searchParams;
  const rows = await getPortalRedemptions(session.customerId);

  return (
    <>
      <PageHeader
        title="My redemptions"
        description="Products waiting for delivery and coupons you can use in the store."
      />
      {ok ? <Alert kind="success">{ok}</Alert> : null}

      <TableRegion label="Your redemptions">
        <table className="data-table">
          <caption>{rows.length} redemptions</caption>
          <thead>
            <tr>
              <th scope="col">Reward</th>
              <th scope="col">Requested</th>
              <th scope="col" className="num">
                Points
              </th>
              <th scope="col">Status</th>
              <th scope="col">Coupon</th>
              <th scope="col">Expires</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6}>You have not redeemed anything yet.</EmptyRow>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.rewardName}</th>
                  <td data-label="Requested">{row.createdAt.toISOString().slice(0, 10)}</td>
                  <td data-label="Points" className="num">
                    {row.pointsCost.toLocaleString("en-US")}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={row.status} />
                  </td>
                  <td data-label="Coupon">
                    {row.couponCode ? (
                      <span className="row">
                        <code>{row.couponCode}</code>
                        <StatusBadge status={row.couponStatus ?? "valid"} />
                      </span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td data-label="Expires">
                    {row.expiresAt ? row.expiresAt.toISOString().slice(0, 10) : "-"}
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
