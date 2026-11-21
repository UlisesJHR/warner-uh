import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import {
  CLIENT_COOKIE,
  CLIENT_SESSION_TTL_MS,
  PERMISSIONS,
  SESSION_TTL_MS,
  STAFF_COOKIE,
  type Permission,
} from "./constants";
import { clientAccounts, customers, roles, sessions, staffUsers } from "./db/schema";
import { getDb } from "./db";

/**
 * Authentication and authorisation.
 *
 * Passwords use scrypt from the Node standard library: it is memory hard, needs
 * no native dependency, and avoids pinning a bcrypt build for the Vercel runtime.
 * Sessions are opaque random tokens in an httpOnly cookie; only their SHA-256
 * hash is stored, so the database alone cannot be used to replay a session.
 */

const scryptAsync = promisify(scrypt);
const SCRYPT_KEY_LENGTH = 64;

/** Hash a password into a self describing string: scrypt:<salt>:<hash>. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

/** Compare a submitted password against a stored hash in constant time. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    return false;
  }
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }
  const derived = (await scryptAsync(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) {
    return false;
  }
  return timingSafeEqual(expected, derived);
}

/** SHA-256 hex digest for session and API tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Build a readable temporary password. Ambiguous characters are excluded so it
 * can be read aloud to a customer without mistakes.
 */
export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
  const bytes = randomBytes(14);
  let password = "";
  for (let index = 0; index < bytes.length; index += 1) {
    password += alphabet[bytes[index] % alphabet.length];
  }
  return `${password.slice(0, 5)}-${password.slice(5, 10)}-${password.slice(10)}`;
}

/** Create a staff session row and set its cookie. */
export async function createStaffSession(staffUserId: string): Promise<void> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    kind: "staff",
    staffUserId,
    expiresAt,
  });
  const jar = await cookies();
  jar.set(STAFF_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Create a portal session row and set its cookie. */
export async function createClientSession(clientAccountId: string): Promise<void> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CLIENT_SESSION_TTL_MS);
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    kind: "client",
    clientAccountId,
    expiresAt,
  });
  const jar = await cookies();
  jar.set(CLIENT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Remove the current session row and clear both cookies. */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const staffToken = jar.get(STAFF_COOKIE)?.value;
  const clientToken = jar.get(CLIENT_COOKIE)?.value;
  const db = await getDb();
  if (staffToken) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(staffToken)));
  }
  if (clientToken) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(clientToken)));
  }
  jar.delete(STAFF_COOKIE);
  jar.delete(CLIENT_COOKIE);
}

export type StaffSession = {
  staffUserId: string;
  name: string;
  email: string;
  roleName: string;
  permissions: Permission[];
};

/**
 * Resolve the current staff session. Expired rows are treated as signed out; the
 * join makes sure a deactivated user or a deleted role stops working instantly.
 */
export async function getStaffSession(): Promise<StaffSession | null> {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  if (!token) {
    return null;
  }
  const db = await getDb();
  const rows = await db
    .select({
      staffUserId: staffUsers.id,
      name: staffUsers.name,
      email: staffUsers.email,
      active: staffUsers.active,
      roleName: roles.name,
      permissions: roles.permissions,
    })
    .from(sessions)
    .innerJoin(staffUsers, eq(sessions.staffUserId, staffUsers.id))
    .innerJoin(roles, eq(staffUsers.roleId, roles.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        eq(sessions.kind, "staff"),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.active) {
    return null;
  }
  const known = new Set<string>(PERMISSIONS);
  return {
    staffUserId: row.staffUserId,
    name: row.name,
    email: row.email,
    roleName: row.roleName,
    permissions: (row.permissions ?? []).filter((value): value is Permission => known.has(value)),
  };
}

/** True when the session holds the permission, checked on the server only. */
export function hasPermission(session: StaffSession | null, permission: Permission): boolean {
  return Boolean(session?.permissions.includes(permission));
}

/** Redirect to the staff login unless a valid session exists. */
export async function requireStaffSession(): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

/**
 * Enforce a permission on the server.
 *
 * Every page and every server action calls this; hiding a button in the markup is
 * never treated as access control.
 */
export async function requirePermission(permission: Permission): Promise<StaffSession> {
  const session = await requireStaffSession();
  if (!hasPermission(session, permission)) {
    redirect("/admin/forbidden");
  }
  return session;
}

export type ClientSession = {
  clientAccountId: string;
  customerId: number;
  email: string;
  mustChangePassword: boolean;
  name: string;
};

/** Resolve the current portal session, including the customer it belongs to. */
export async function getClientSession(): Promise<ClientSession | null> {
  const token = (await cookies()).get(CLIENT_COOKIE)?.value;
  if (!token) {
    return null;
  }
  const db = await getDb();
  const rows = await db
    .select({
      clientAccountId: clientAccounts.id,
      customerId: clientAccounts.customerId,
      email: clientAccounts.email,
      mustChangePassword: clientAccounts.mustChangePassword,
      active: clientAccounts.active,
      name: customers.name,
    })
    .from(sessions)
    .innerJoin(clientAccounts, eq(sessions.clientAccountId, clientAccounts.id))
    .innerJoin(customers, eq(clientAccounts.customerId, customers.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        eq(sessions.kind, "client"),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.active) {
    return null;
  }
  return {
    clientAccountId: row.clientAccountId,
    customerId: row.customerId,
    email: row.email,
    mustChangePassword: row.mustChangePassword,
    name: row.name,
  };
}

/** Redirect to the portal login unless a valid portal session exists. */
export async function requireClientSession(): Promise<ClientSession> {
  const session = await getClientSession();
  if (!session) {
    redirect("/portal/login");
  }
  return session;
}

/**
 * Guard for the portal pages. A customer who still holds a temporary password is
 * forced to the password screen before any loyalty data is rendered.
 */
export async function requireReadyClientSession(): Promise<ClientSession> {
  const session = await requireClientSession();
  if (session.mustChangePassword) {
    redirect("/portal/password");
  }
  return session;
}
