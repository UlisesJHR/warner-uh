import Link from "next/link";
import { Alert, EmptyRow, Field, PageHeader, TableRegion } from "@/components/ui";
import { saveRoleAction } from "@/app/actions/admin";
import { requirePermission } from "@/lib/auth";
import { listRoles } from "@/lib/queries";

/**
 * Role list and creation.
 *
 * Roles are editable database rows, but the permissions they can reference come
 * from the fixed catalogue in the code, as the specification requires.
 */
export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("roles:manage");
  const { ok, error } = await searchParams;
  const roles = await listRoles();

  return (
    <>
      <PageHeader
        title="Roles and permissions"
        description="Create a role, then choose the exact permissions it grants."
      />

      {ok ? <Alert kind="success">{ok}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <section className="card" style={{ marginBlock: "1rem" }}>
        <h2>New role</h2>
        <form action={saveRoleAction} className="form form-wide">
          <Field label="Role name" name="name" required />
          <Field label="Description" name="description" />
          <p className="muted">Create the role first, then pick its permissions on the next screen.</p>
          <button type="submit" className="button button-primary">
            Create role
          </button>
        </form>
      </section>

      <TableRegion label="Roles">
        <table className="data-table">
          <caption>{roles.length} roles</caption>
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Description</th>
              <th scope="col" className="num">
                Permissions
              </th>
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 ? (
              <EmptyRow colSpan={3}>No roles yet.</EmptyRow>
            ) : (
              roles.map((role) => (
                <tr key={role.id}>
                  <th scope="row">
                    <Link href={`/admin/roles/${role.id}`}>{role.name}</Link>
                    {role.isSystem ? <span className="badge" style={{ marginInlineStart: "0.5rem" }}>Preset</span> : null}
                  </th>
                  <td data-label="Description">{role.description || "-"}</td>
                  <td data-label="Permissions" className="num">
                    {role.permissions.length}
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
