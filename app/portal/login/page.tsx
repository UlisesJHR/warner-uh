import { redirect } from "next/navigation";
import { Alert, Field } from "@/components/ui";
import { clientLoginAction } from "@/app/actions/auth";
import { getClientSession } from "@/lib/auth";

/**
 * Customer portal login.
 *
 * Accounts are created by the synchronisation without a password; the store team
 * generates access from the panel and the first sign in forces a password change.
 */
export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getClientSession();
  if (session) {
    redirect(session.mustChangePassword ? "/portal/password" : "/portal");
  }
  const { error } = await searchParams;

  return (
    <div className="login-wrap">
      <div className="card login-card stack">
        <div className="stack" style={{ gap: "0.25rem" }}>
          <h1>Store rewards</h1>
          <p className="muted">Sign in to see your points, level and rewards.</p>
        </div>

        {error ? <Alert kind="error">{error}</Alert> : null}

        <form action={clientLoginAction} className="form">
          <Field
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            hint="Use the temporary password the store gave you the first time."
          />
          <button type="submit" className="button button-primary">
            Sign in
          </button>
        </form>

        <p className="muted">
          Store team? <a href="/login">Open the internal panel</a>.
        </p>
      </div>
    </div>
  );
}
