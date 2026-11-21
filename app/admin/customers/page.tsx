import Link from "next/link";
import { EmptyRow, LevelBadge, PageHeader, TableRegion } from "@/components/ui";
import { hasPermission, requirePermission } from "@/lib/auth";
import { searchCustomers } from "@/lib/queries";
import { formatCents } from "@/lib/loyalty";

/**
 * Customer search.
 *
 * The query is a GET parameter so results can be bookmarked and the browser back
 * button keeps working. Amounts are only rendered when the role allows them.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePermission("customers:read");
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const rows = await searchCustomers(query);
  const showAmounts = hasPermission(session, "customers:amounts");

  return (
    <>
      <PageHeader
        title="Customers"
        description="Search by name, email or source id. Every value comes from the last synchronisation."
      />

      <form className="form form-wide row" action="/admin/customers" method="get" role="search">
        <div className="field" style={{ flex: "1 1 18rem" }}>
          <label htmlFor="customer-search">Search customers</label>
          <input
            id="customer-search"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Name, email or id"
            autoComplete="off"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="none"
          />
        </div>
        <button type="submit" className="button">
          Search
        </button>
      </form>

      <div style={{ marginBlockStart: "1rem" }}>
        <TableRegion label="Customer search results">
          <table className="data-table">
            <caption>
              {rows.length} customer{rows.length === 1 ? "" : "s"}
              {query ? ` matching "${query}"` : ""}
            </caption>
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
                <th scope="col">Portal access</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={showAmounts ? 6 : 5}>No customer matches this search.</EmptyRow>
              ) : (
                rows.map((customer) => (
                  <tr key={customer.id}>
                    <th scope="row">
                      <Link href={`/admin/customers/${customer.id}`}>{customer.name}</Link>
                      <div className="muted">
                        #{customer.id} · {customer.email || "no email"}
                      </div>
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
                    <td data-label="Portal access">
                      {customer.hasAccess ? (
                        <span className="badge badge-success">Active</span>
                      ) : (
                        <span className="badge">No access</span>
                      )}
                    </td>
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
      </div>
    </>
  );
}
