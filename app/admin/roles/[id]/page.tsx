import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, CheckboxField, Field, PageHeader } from "@/components/ui";
import { saveRoleAction } from "@/app/actions/admin";
import { PERMISSIONS, PERMISSION_LABELS } from "@/lib/constants";
import { requirePermission } from "@/lib/auth";
import { getRole } from "@/lib/queries";

/**
 * Edit one role.
 *
 * The permission checklist is generated from the code catalogue, so a role can
 * never hold a permission the server does not know how to enforce.
 */
export default async function EditRolePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("roles:manage");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const role = await getRole(id);

  if (!role) {
    notFound();
  }

  return (
    <>
      <PageHeader
        title={`Edit ${role.name}`}
        description={`${role.userCount} user${role.userCount === 1 ? "" : "s"} hold this role. Changes apply at their next request.`}
        actions={
          <Link href="/admin/roles" className="button button-small">
            Back to roles
          </Link>
        }
      />

      {ok ? <Alert kind="success">{ok}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <form action={saveRoleAction} className="form form-wide" style={{ marginBlockStart: "1rem" }}>
        <input type="hidden" name="id" value={role.id} />
        <Field label="Role name" name="name" required defaultValue={role.name} />
        <Field label="Description" name="description" defaultValue={role.description} />

        <fieldset
          className="card"
          style={{ border: "1px solid var(--border)", display: "grid", gap: "0.6rem" }}
        >
          <legend style={{ fontWeight: 600, paddingInline: "0.35rem" }}>Permissions</legend>
          {PERMISSIONS.map((permission) => (
            <CheckboxField
              key={permission}
              name="permissions"
              value={permission}
              label={PERMISSION_LABELS[permission]}
              defaultChecked={role.permissions.includes(permission)}
            />
          ))}
        </fieldset>

        <button type="submit" className="button button-primary">
          Save role
        </button>
      </form>
    </>
  );
}
