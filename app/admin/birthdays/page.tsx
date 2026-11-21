import Link from "next/link";
import { EmptyRow, LevelBadge, PageHeader, TableRegion } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { getUpcomingBirthdays } from "@/lib/queries";

/**
 * Upcoming birthdays.
 *
 * The window starts at the cutoff and lasts seven days inclusive. Only the month
 * and day of `dob` are compared, because a birthday has no timezone.
 */
export default async function BirthdaysPage() {
  await requirePermission("lists:view");
  const customers = await getUpcomingBirthdays();

  return (
    <>
      <PageHeader
        title="Upcoming birthdays"
        description="Birthdays between 30 April 2026 and 7 May 2026, both days included."
      />

      <TableRegion label="Customers with an upcoming birthday">
        <table className="data-table">
          <caption>{customers.length} birthday campaigns to send</caption>
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Level</th>
              <th scope="col">Birthday</th>
              <th scope="col">Date in window</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 ? (
              <EmptyRow colSpan={4}>No birthday falls inside this window.</EmptyRow>
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
                  <td data-label="Birthday">{customer.dob}</td>
                  <td data-label="Date in window">{customer.date}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableRegion>
    </>
  );
}
