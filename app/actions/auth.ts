"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  createClientSession,
  createStaffSession,
  destroySession,
  getClientSession,
  hashPassword,
  requireClientSession,
  verifyPassword,
} from "@/lib/auth";
import { getDb } from "@/lib/db";
import { clientAccounts, staffUsers } from "@/lib/db/schema";

/**
 * Session server actions.
 *
 * Every action validates input again on the server, writes a hashed session and
 * redirects. Errors travel as a short query parameter, which keeps the login
 * screens server rendered with no client JavaScript.
 */

/** Sign an internal user in and send them to the panel. */
export async function staffLoginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=Enter your email and password.");
  }

  const db = await getDb();
  const [user] = await db
    .select({
      id: staffUsers.id,
      passwordHash: staffUsers.passwordHash,
      active: staffUsers.active,
    })
    .from(staffUsers)
    .where(eq(staffUsers.email, email))
    .limit(1);

  // The same message for an unknown email and a wrong password avoids leaking
  // which accounts exist.
  const valid = user && user.active && (await verifyPassword(password, user.passwordHash));
  if (!user || !valid) {
    redirect("/login?error=Invalid email or password.");
  }

  await db.update(staffUsers).set({ lastLoginAt: new Date() }).where(eq(staffUsers.id, user.id));
  await createStaffSession(user.id);
  redirect("/admin");
}

/** Sign a customer into the portal. */
export async function clientLoginAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/portal/login?error=Enter your email and password.");
  }

  const db = await getDb();
  const [account] = await db
    .select({
      id: clientAccounts.id,
      passwordHash: clientAccounts.passwordHash,
      active: clientAccounts.active,
      mustChangePassword: clientAccounts.mustChangePassword,
    })
    .from(clientAccounts)
    .where(eq(clientAccounts.email, email))
    .limit(1);

  if (!account || !account.active) {
    redirect("/portal/login?error=Invalid email or password.");
  }
  if (!account.passwordHash) {
    redirect("/portal/login?error=This account has no access yet. Ask the store for access.");
  }
  if (!(await verifyPassword(password, account.passwordHash))) {
    redirect("/portal/login?error=Invalid email or password.");
  }

  await db
    .update(clientAccounts)
    .set({ lastLoginAt: new Date() })
    .where(eq(clientAccounts.id, account.id));
  await createClientSession(account.id);
  redirect(account.mustChangePassword ? "/portal/password" : "/portal");
}

/** Clear the current session and return to the portal login. */
export async function clientLogoutAction(): Promise<void> {
  await destroySession();
  redirect("/portal/login");
}

/** Clear the current session and return to the panel login. */
export async function staffLogoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/**
 * Replace the temporary password on the first portal visit.
 *
 * The current password is required again, the new one must be at least 10
 * characters, and the temporary password is rejected so the forced change cannot
 * be skipped by reusing it.
 */
export async function changeClientPasswordAction(formData: FormData): Promise<void> {
  const session = await requireClientSession();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (next.length < 10) {
    redirect("/portal/password?error=Use at least 10 characters for the new password.");
  }
  if (next !== confirm) {
    redirect("/portal/password?error=The two new passwords do not match.");
  }
  if (next === current) {
    redirect("/portal/password?error=Choose a password different from the temporary one.");
  }

  const db = await getDb();
  const [account] = await db
    .select({ id: clientAccounts.id, passwordHash: clientAccounts.passwordHash })
    .from(clientAccounts)
    .where(eq(clientAccounts.id, session.clientAccountId))
    .limit(1);

  if (!account || !(await verifyPassword(current, account.passwordHash))) {
    redirect("/portal/password?error=The current password is not correct.");
  }

  await db
    .update(clientAccounts)
    .set({ passwordHash: await hashPassword(next), mustChangePassword: false })
    .where(eq(clientAccounts.id, account.id));

  redirect("/portal?ok=Your password was updated.");
}

/** Send a signed-out visitor away from a guarded screen. */
export async function ensureClientSignedIn(): Promise<void> {
  const session = await getClientSession();
  if (!session) {
    redirect("/portal/login");
  }
}
