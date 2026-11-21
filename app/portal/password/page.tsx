import { redirect } from "next/navigation";
import { Alert, Field, PageHeader } from "@/components/ui";
import { changeClientPasswordAction } from "@/app/actions/auth";
import { requireClientSession } from "@/lib/auth";

/**
 * Forced password change.
 *
 * A customer who still has the temporary password cannot reach any loyalty data
 * until a new password is set here. The current password is required again so a
 * stolen session cannot lock the owner out.
 */
export default async function PortalPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireClientSession();
  if (!session.mustChangePassword) {
    redirect("/portal");
  }
  const { error } = await searchParams;

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <PageHeader
          title="Choose your password"
          description="This is your first sign in, so the temporary password has to be replaced."
        />
        {error ? <Alert kind="error">{error}</Alert> : null}
        <form action={changeClientPasswordAction} className="form" style={{ marginBlockStart: "1rem" }}>
          <Field
            label="Temporary password"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
          />
          <Field
            label="New password"
            name="newPassword"
            type="password"
            required
            autoComplete="new-password"
            minLength={10}
            hint="At least 10 characters. Do not reuse the temporary password."
          />
          <Field
            label="Repeat the new password"
            name="confirmPassword"
            type="password"
            required
            autoComplete="new-password"
            minLength={10}
          />
          <button type="submit" className="button button-primary">
            Save password
          </button>
        </form>
      </div>
    </div>
  );
}
