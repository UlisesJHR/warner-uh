import { redirect } from "next/navigation";
import { Alert, Field } from "@/components/ui";
import { getStaffSession } from "@/lib/auth";
import { staffLoginAction } from "@/app/actions/auth";

/**
 * Staff login screen.
 *
 * The form posts to a server action; a failed attempt comes back as a query
 * parameter and is rendered as an alert instead of a field level error, because
 * the failure can belong to either field.
 */
export default async function StaffLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getStaffSession();
  if (session) {
    redirect("/admin");
  }
  const { error } = await searchParams;

  return (
    <main className="login-wrap">
      <div className="card login-card stack">
        <div className="stack" style={{ gap: "0.25rem" }}>
          <h1>Loyalty panel</h1>
          <p className="muted">Sign in with your work account.</p>
        </div>

        {error ? <Alert kind="error">{error}</Alert> : null}

        <form action={staffLoginAction} className="form">
          <Field
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@store.test"
          />
          <Field
            label="Password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
          <button type="submit" className="button button-primary">
            Sign in
          </button>
        </form>

        <p className="muted">
          Shopping as a customer? <a href="/portal/login">Open the customer portal</a>.
        </p>
      </div>
    </main>
  );
}
