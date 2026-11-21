import Link from "next/link";
import { EmptyRow, LevelBadge, PageHeader, TableRegion } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { getRiskCustomers } from "@/lib/queries";

/**
 * At-risk customers.
 *
 * A customer is at risk when at least one payment succeeded and the last activity
 * was 90 days or more before the cutoff. Activity is a succeeded payment or an
 * order that is not cancelled.
 */
export default async function RiskPage() {
  await requirePermission("lists:view");
  const customers = await getRiskCustomers();

  return (
    <>
      <PageHeader
        title="Customers at risk"
        description="90 days or more without activity before 30 April 2026, with at least one successful payment."
      />

      <TableRegion label="Customers at risk">
        <table className="data-table">
          <caption>{customers.length} customers need a follow up</caption>
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Level</th>
              <th scope="col" className="num">
                Days without activity
              </th>
              <th scope="col">Points</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <EmptyRow colSpan={4}>No customer is at risk at the cutoff date.</EmptyRow>
            ) : (
              customers.map((customer) => (
                <tr key={customer.id}>
                  <th scope="row">
                    <Link href={`/admin/customers/${customer.id}`}>{customer.name}</Link>
                    <div className="muted">{customer.email}</div>
                  </th>
                  <td data-label="Level">
                    <LevelBadge level={customer.level} />
                  </td>
                  <td data-label="Days without activity" className="num">
                    {customer.daysInactive ?? "-"}
                  </td>
                  <td data-label="Points" className="num">
                    {customer.pointsEarned.toLocaleString("en-US")}
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
