import { Alert, EmptyRow, Field, PageHeader, TableRegion } from "@/components/ui";
import { revokeTokenAction } from "@/app/actions/admin";
import { requirePermission } from "@/lib/auth";
import { listApiTokens } from "@/lib/queries";

/**
 * Evaluation API tokens.
 *
 * The token value is shown once by the route handler that creates it; this screen
 * only ever lists the label, the prefix and the lifecycle timestamps.
 */
export default async function TokensPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("tokens:manage");
  const { ok, error } = await searchParams;
  const tokens = await listApiTokens();

  return (
    <>
      <PageHeader
        title="API tokens"
        description="Bearer tokens for the /api/fidelizacion endpoints. Only a hash is stored."
      />

      {ok ? <Alert kind="success">{ok}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      <section className="card" style={{ marginBlock: "1rem" }}>
        <h2>Create a token</h2>
        <form action="/api/staff/tokens" method="post" className="form form-wide">
          <Field
            label="Label"
            name="label"
            hint="For example: evaluation team, or reporting script."
            defaultValue="Evaluation token"
          />
          <button type="submit" className="button button-primary">
            Generate token
          </button>
        </form>
      </section>

      <TableRegion label="API tokens">
        <table className="data-table">
          <caption>{tokens.length} tokens</caption>
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">Prefix</th>
              <th scope="col">Created</th>
              <th scope="col">Last used</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tokens.length === 0 ? (
              <EmptyRow colSpan={6}>No token yet. Generate one to call the validation endpoints.</EmptyRow>
            ) : (
              tokens.map((token) => (
                <tr key={token.id}>
                  <th scope="row">{token.label}</th>
                  <td data-label="Prefix">
                    <code>{token.prefix}...</code>
                  </td>
                  <td data-label="Created">{token.createdAt.toISOString().slice(0, 10)}</td>
                  <td data-label="Last used">
                    {token.lastUsedAt
                      ? token.lastUsedAt.toISOString().slice(0, 16).replace("T", " ")
                      : "Never"}
                  </td>
                  <td data-label="Status">
                    {token.revokedAt ? (
                      <span className="badge badge-danger">Revoked</span>
                    ) : (
                      <span className="badge badge-success">Active</span>
                    )}
                  </td>
                  <td data-label="Actions">
                    {token.revokedAt ? (
                      "-"
                    ) : (
                      <form action={revokeTokenAction} className="inline-form">
                        <input type="hidden" name="id" value={token.id} />
                        <button type="submit" className="button button-small button-danger">
                          Revoke
                        </button>
                      </form>
                    )}
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
