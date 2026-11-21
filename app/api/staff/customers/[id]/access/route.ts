import { eq } from "drizzle-orm";
import {
  generateTemporaryPassword,
  getStaffSession,
  hasPermission,
  hashPassword,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { clientAccounts, customers } from "@/lib/db/schema";

/**
 * Generate or reset a portal password.
 *
 * This is a route handler instead of a server action because the temporary
 * password has to be displayed exactly once. Returning a small HTML document with
 * `no-store` avoids putting the secret in a redirect URL, in history, or in the
 * database as clear text; only its scrypt hash is persisted.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getStaffSession();
  if (!session) {
    return htmlResponse("<p>Sign in to continue.</p>", 401);
  }
  if (!hasPermission(session, "portal-access:generate")) {
    return htmlResponse("<p>Your role cannot generate portal access.</p>", 403);
  }

  const { id } = await context.params;
  const customerId = Number(id);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return htmlResponse("<p>Invalid customer.</p>", 400);
  }

  const db = await getDb();
  const [customer] = await db
    .select({ id: customers.id, name: customers.name, email: customers.email })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!customer) {
    return htmlResponse("<p>Customer not found.</p>", 404);
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const [account] = await db
    .select({ id: clientAccounts.id, email: clientAccounts.email })
    .from(clientAccounts)
    .where(eq(clientAccounts.customerId, customerId))
    .limit(1);

  let email = account?.email ?? customer.email;
  if (account) {
    await db
      .update(clientAccounts)
      .set({ passwordHash, mustChangePassword: true, active: true })
      .where(eq(clientAccounts.id, account.id));
  } else {
    email = email || `customer-${customerId}@fidelizacion.local`;
    const inserted = await db
      .insert(clientAccounts)
      .values({ customerId, email, passwordHash, mustChangePassword: true })
      .onConflictDoNothing()
      .returning({ id: clientAccounts.id });
    if (inserted.length === 0) {
      // The email already belongs to another account, so fall back to a stable one.
      email = `customer-${customerId}@fidelizacion.local`;
      await db
        .insert(clientAccounts)
        .values({ customerId, email, passwordHash, mustChangePassword: true })
        .onConflictDoUpdate({
          target: clientAccounts.customerId,
          set: { passwordHash, mustChangePassword: true, active: true },
        });
    }
  }

  const escapedName = escapeHtml(customer.name);
  const escapedEmail = escapeHtml(email);
  const escapedPassword = escapeHtml(temporaryPassword);

  return htmlResponse(
    `<p class="ok">Access for ${escapedName} is ready.</p>
     <p>Email: <strong>${escapedEmail}</strong></p>
     <p>One time password: <code>${escapedPassword}</code></p>
     <p class="hint">Copy it now. It is not stored anywhere and cannot be shown again. The customer must choose a new password at the first sign in.</p>
     <p><a href="/admin/customers/${customerId}">Back to the customer</a></p>`,
    200,
  );
}

/** Escape user controlled text before it is placed in the one time HTML page. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Minimal standalone HTML document, never cached by the browser. */
function htmlResponse(body: string, status: number): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Portal access</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; padding: 2rem 1.25rem; background: light-dark(#f6f5f3, #14161c); color: light-dark(#1b1b1b, #f2f2f2); }
  main { max-width: 34rem; margin: 0 auto; background: light-dark(#fff, #1d2028); border: 1px solid light-dark(#e2e0dc, #333a48); border-radius: 12px; padding: 1.5rem; }
  code { font-size: 1.15rem; padding: 0.15rem 0.4rem; border-radius: 6px; background: light-dark(#f0ede8, #262b36); }
  .hint { color: light-dark(#5a5a5a, #b4b8c2); font-size: 0.9rem; }
  .ok { font-weight: 600; }
  a { color: light-dark(#a15c14, #f0b070); }
</style>
</head>
<body><main>${body}</main></body>
</html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
