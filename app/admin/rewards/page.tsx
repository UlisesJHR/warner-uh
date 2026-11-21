import Link from "next/link";
import { Alert, EmptyRow, PageHeader, TableRegion } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { listRewards } from "@/lib/queries";
import { formatCents } from "@/lib/loyalty";

/**
 * Reward catalogue list.
 *
 * Products and discounts share the table; the kind column explains which one the
 * customer receives after redeeming.
 */
export default async function RewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("rewards:manage");
  const { ok, error } = await searchParams;
  const items = await listRewards();

  return (
    <>
      <PageHeader
        title="Rewards"
        description="Products and discounts that customers can redeem with points."
        actions={
          <Link href="/admin/rewards/new" className="button button-primary button-small">
            New reward
          </Link>
        }
      />

      {ok ? <Alert kind="success">{ok}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <div style={{ marginBlockStart: "1rem" }}>
        <TableRegion label="Reward catalogue">
          <table className="data-table">
            <caption>{items.length} rewards</caption>
            <thead>
              <tr>
                <th scope="col">Reward</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">
                  Points
                </th>
                <th scope="col" className="num">
                  Stock
                </th>
                <th scope="col">Minimum level</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <EmptyRow colSpan={6}>No rewards yet. Create the first one.</EmptyRow>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">
                      <Link href={`/admin/rewards/${item.id}`}>{item.name}</Link>
                      <div className="muted">
                        {item.kind === "discount"
                          ? `${item.discountType === "percentage" ? `${(item.discountValueCents ?? 0) / 100}% off` : `$${formatCents(item.discountValueCents ?? 0)} off`}`
                          : "Requires delivery"}
                      </div>
                    </th>
                    <td data-label="Type">{item.kind}</td>
                    <td data-label="Points" className="num">
                      {item.pointsCost.toLocaleString("en-US")}
                    </td>
                    <td data-label="Stock" className="num">
                      {item.stock === null ? "Unlimited" : item.stock}
                    </td>
                    <td data-label="Minimum level">{item.minLevel}</td>
                    <td data-label="Status">
                      {item.active ? (
                        <span className="badge badge-success">Active</span>
                      ) : (
                        <span className="badge">Inactive</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableRegion>
      </div>
    </>
  );
}
