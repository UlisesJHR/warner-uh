import { Alert, EmptyRow, Field, PageHeader, SelectField, TableRegion } from "@/components/ui";
import { saveUserAction, toggleUserActiveAction } from "@/app/actions/admin";
import { requirePermission } from "@/lib/auth";
import { listRoles, listStaffUsers } from "@/lib/queries";

/**
 * Internal user management.
 *
 * The administrator creates accounts, assigns a role and deactivates them. The
 * last active administrator cannot be deactivated; the action enforces that on the
 * server and reports it here.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("users:manage");
  const { ok, error } = await searchParams;
  const [users, roles] = await Promise.all([listStaffUsers(), listRoles()]);
  const roleOptions = roles.map((role) => ({ value: role.id, label: role.name }));

  return (
    <>
      <PageHeader
        title="Internal users"
        description="Accounts for the store team. Customers sign in through the portal instead."
      />

      {ok ? <Alert kind="success">{ok}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <section className="card" style={{ marginBlock: "1rem" }}>
        <h2>Create a user</h2>
        <form action={saveUserAction} className="form form-wide">
          <Field label="Name" name="name" required autoComplete="name" />
          <Field label="Email" name="email" type="email" required autoComplete="email" />
          <SelectField label="Role" name="roleId" required options={roleOptions} />
          <Field
            label="Initial password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            hint="At least 10 characters. The user can be given a new one at any time."
          />
          <button type="submit" className="button button-primary">
            Create user
          </button>
        </form>
      </section>

      <TableRegion label="Internal users">
        <table className="data-table">
          <caption>{users.length} accounts</caption>
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Role</th>
              <th scope="col">Last sign in</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <EmptyRow colSpan={5}>No users yet.</EmptyRow>
            ) : (
              users.map((user) => (
                <tr key={user.id}>
                  <th scope="row">
                    {user.name}
                    <div className="muted">{user.email}</div>
                  </th>
                  <td data-label="Role">
                    <form action={saveUserAction} className="inline-form">
                      <input type="hidden" name="id" value={user.id} />
                      <input type="hidden" name="name" value={user.name} />
                      <input type="hidden" name="email" value={user.email} />
                      <label htmlFor={`role-${user.id}`} className="visually-hidden">
                        Role for {user.name}
                      </label>
                      <select id={`role-${user.id}`} name="roleId" defaultValue={user.roleId}>
                        {roleOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="button button-small">
                        Save
                      </button>
                    </form>
                  </td>
                  <td data-label="Last sign in">
                    {user.lastLoginAt ? user.lastLoginAt.toISOString().slice(0, 16).replace("T", " ") : "Never"}
                  </td>
                  <td data-label="Status">
                    {user.active ? (
                      <span className="badge badge-success">Active</span>
                    ) : (
                      <span className="badge">Inactive</span>
                    )}
                  </td>
                  <td data-label="Actions">
                    <form action={toggleUserActiveAction} className="inline-form">
                      <input type="hidden" name="id" value={user.id} />
                      <input type="hidden" name="active" value={user.active ? "false" : "true"} />
                      <button
                        type="submit"
                        className={`button button-small ${user.active ? "button-danger" : ""}`}
                      >
                        {user.active ? "Deactivate" : "Activate"}
                      </button>
                    </form>
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
