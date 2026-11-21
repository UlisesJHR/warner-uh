"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  PERMISSIONS,
  type Permission,
} from "@/lib/constants";
import { hashPassword, requirePermission } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  apiTokens,
  redemptions,
  rewards,
  roles,
  staffUsers,
} from "@/lib/db/schema";
import { cancelRedemption, deliverRedemption } from "@/lib/redeem";
import { runSync } from "@/lib/sync";
import { uploadRewardImage } from "@/lib/storage";
import { LEVELS } from "@/lib/constants";

/**
 * Panel server actions.
 *
 * Each action calls `requirePermission` before touching the database, so a forged
 * request from a signed-in user without the permission is refused on the server.
 * Results travel back to the screen as a query parameter to keep the UI server
 * rendered.
 */

/** Read a trimmed string field from a submitted form. */
function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Read an optional integer field, mapping an empty value to null. */
function optionalInt(formData: FormData, key: string): number | null {
  const raw = text(formData, key);
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

/** Only allow permissions that exist in the fixed catalogue. */
function readPermissions(formData: FormData): Permission[] {
  const submitted = formData.getAll("permissions").map(String);
  const known = new Set<string>(PERMISSIONS);
  return submitted.filter((value): value is Permission => known.has(value));
}

/** Create or update an internal user. */
export async function saveUserAction(formData: FormData): Promise<void> {
  await requirePermission("users:manage");
  const db = await getDb();
  const id = text(formData, "id");
  const name = text(formData, "name");
  const email = text(formData, "email").toLowerCase();
  const roleId = text(formData, "roleId");
  const password = text(formData, "password");

  if (!name || !email || !roleId) {
    redirect("/admin/users?error=Name, email and role are required.");
  }

  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) {
    redirect("/admin/users?error=Choose an existing role.");
  }

  if (id) {
    await db
      .update(staffUsers)
      .set({
        name,
        email,
        roleId,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
      })
      .where(eq(staffUsers.id, id));
    revalidatePath("/admin/users");
    redirect("/admin/users?ok=User updated.");
  }

  if (password.length < 10) {
    redirect("/admin/users?error=The initial password needs at least 10 characters.");
  }

  const [existing] = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(eq(staffUsers.email, email))
    .limit(1);
  if (existing) {
    redirect("/admin/users?error=That email is already in use.");
  }

  await db.insert(staffUsers).values({
    name,
    email,
    roleId,
    passwordHash: await hashPassword(password),
  });
  revalidatePath("/admin/users");
  redirect("/admin/users?ok=User created.");
}

/**
 * Activate or deactivate a user.
 *
 * The last active administrator cannot be deactivated, otherwise nobody could
 * manage the programme any more.
 */
export async function toggleUserActiveAction(formData: FormData): Promise<void> {
  const session = await requirePermission("users:manage");
  const db = await getDb();
  const id = text(formData, "id");
  const nextActive = text(formData, "active") === "true";

  if (id === session.staffUserId && !nextActive) {
    redirect("/admin/users?error=You cannot deactivate your own account.");
  }

  const [target] = await db
    .select({ id: staffUsers.id, roleId: staffUsers.roleId })
    .from(staffUsers)
    .where(eq(staffUsers.id, id))
    .limit(1);
  if (!target) {
    redirect("/admin/users?error=User not found.");
  }

  if (!nextActive) {
    const [adminRole] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, "Administrator"))
      .limit(1);
    if (adminRole && target.roleId === adminRole.id) {
      const [remaining] = await db
        .select({ total: sql<string>`count(*)` })
        .from(staffUsers)
        .where(
          and(
            eq(staffUsers.roleId, adminRole.id),
            eq(staffUsers.active, true),
            ne(staffUsers.id, id),
          ),
        );
      if (Number(remaining?.total ?? 0) === 0) {
        redirect("/admin/users?error=You cannot deactivate the last active administrator.");
      }
    }
  }

  await db.update(staffUsers).set({ active: nextActive }).where(eq(staffUsers.id, id));
  revalidatePath("/admin/users");
  redirect(`/admin/users?ok=User ${nextActive ? "activated" : "deactivated"}.`);
}

/** Create a role or replace its name, description and permissions. */
export async function saveRoleAction(formData: FormData): Promise<void> {
  await requirePermission("roles:manage");
  const db = await getDb();
  const id = text(formData, "id");
  const name = text(formData, "name");
  const description = text(formData, "description");
  const permissions = readPermissions(formData);

  if (!name) {
    redirect("/admin/roles?error=A role name is required.");
  }

  if (id) {
    await db.update(roles).set({ name, description, permissions }).where(eq(roles.id, id));
    revalidatePath("/admin/roles");
    revalidatePath(`/admin/roles/${id}`);
    redirect(`/admin/roles/${id}?ok=Role saved.`);
  }

  const [existing] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)).limit(1);
  if (existing) {
    redirect("/admin/roles?error=A role with that name already exists.");
  }

  const [created] = await db
    .insert(roles)
    .values({ name, description, permissions })
    .returning({ id: roles.id });
  revalidatePath("/admin/roles");
  redirect(`/admin/roles/${created.id}?ok=Role created.`);
}

/** Create or update a reward, including an optional image upload. */
export async function saveRewardAction(formData: FormData): Promise<void> {
  await requirePermission("rewards:manage");
  const db = await getDb();
  const id = text(formData, "id");
  const name = text(formData, "name");
  const description = text(formData, "description");
  const kind = text(formData, "kind") === "discount" ? "discount" : "product";
  const pointsCost = optionalInt(formData, "pointsCost") ?? 0;
  const stock = optionalInt(formData, "stock");
  const minLevel = (LEVELS as readonly string[]).includes(text(formData, "minLevel"))
    ? text(formData, "minLevel")
    : "Bronce";
  const perCustomerLimit = optionalInt(formData, "perCustomerLimit");
  const active = formData.get("active") !== null;

  const backTo = id ? `/admin/rewards/${id}` : "/admin/rewards";

  if (!name || pointsCost < 1) {
    redirect(`${backTo}?error=A name and a points cost of at least 1 are required.`);
  }

  // A discount needs its type and value; a product ignores those fields.
  const discountType = kind === "discount" ? text(formData, "discountType") : null;
  const discountValue = kind === "discount" ? optionalInt(formData, "discountValue") : null;
  if (kind === "discount" && (!discountType || !discountValue || discountValue < 1)) {
    redirect(`${backTo}?error=Discounts need a type and a value.`);
  }

  // A percentage is stored in hundredths of a percent, an amount in cents.
  let discountValueCents: number | null = null;
  if (kind === "discount" && discountValue !== null) {
    discountValueCents = discountType === "percentage" ? discountValue : discountValue * 100;
  }

  const uploaded = await uploadRewardImage(formData.get("image") as File | null);
  if (uploaded && "error" in uploaded) {
    redirect(`${backTo}?error=${encodeURIComponent(uploaded.error)}`);
  }
  const typedUrl = text(formData, "imageUrl");
  const imageUrl =
    uploaded && "url" in uploaded ? uploaded.url : typedUrl || null;

  if (imageUrl && !/^https?:\/\//.test(imageUrl)) {
    redirect(`${backTo}?error=The image URL must start with http:// or https://.`);
  }

  const values = {
    name,
    description,
    kind,
    pointsCost,
    stock,
    minLevel,
    perCustomerLimit,
    active,
    imageUrl,
    discountType: discountType || null,
    discountValueCents,
    minPurchaseCents:
      kind === "discount" && optionalInt(formData, "minPurchase") !== null
        ? (optionalInt(formData, "minPurchase") as number) * 100
        : null,
    validDays: kind === "discount" ? optionalInt(formData, "validDays") : null,
    updatedAt: new Date(),
  };

  if (id) {
    await db.update(rewards).set(values).where(eq(rewards.id, id));
    revalidatePath("/admin/rewards");
    revalidatePath(backTo);
    redirect(`/admin/rewards/${id}?ok=Reward saved.`);
  }

  await db.insert(rewards).values(values);
  revalidatePath("/admin/rewards");
  redirect("/admin/rewards?ok=Reward created.");
}

/** Mark a pending redemption as delivered. */
export async function deliverRedemptionAction(formData: FormData): Promise<void> {
  await requirePermission("redemptions:manage");
  const db = await getDb();
  const id = text(formData, "id");
  const result = await deliverRedemption(db, id);
  revalidatePath("/admin/redemptions");
  redirect(
    result.ok
      ? "/admin/redemptions?ok=Redemption marked as delivered."
      : `/admin/redemptions?error=${encodeURIComponent(result.error)}`,
  );
}

/** Cancel a redemption, which returns its points and its stock. */
export async function cancelRedemptionAction(formData: FormData): Promise<void> {
  await requirePermission("redemptions:manage");
  const db = await getDb();
  const id = text(formData, "id");
  const result = await cancelRedemption(db, id);
  revalidatePath("/admin/redemptions");
  redirect(
    result.ok
      ? "/admin/redemptions?ok=Redemption cancelled and points returned."
      : `/admin/redemptions?error=${encodeURIComponent(result.error)}`,
  );
}

/** Run the source synchronisation on demand. */
export async function runSyncAction(): Promise<void> {
  const session = await requirePermission("sync:run");
  const db = await getDb();
  const result = await runSync(db, { trigger: "manual", triggeredBy: session.email });
  revalidatePath("/admin/sync");
  revalidatePath("/admin");
  redirect(
    result.status === "success"
      ? `/admin/sync?ok=${encodeURIComponent(result.message)}`
      : `/admin/sync?error=${encodeURIComponent(result.message)}`,
  );
}

/** Revoke an API token; the row is kept so the history stays readable. */
export async function revokeTokenAction(formData: FormData): Promise<void> {
  await requirePermission("tokens:manage");
  const db = await getDb();
  const id = text(formData, "id");
  await db.update(apiTokens).set({ revokedAt: new Date() }).where(eq(apiTokens.id, id));
  revalidatePath("/admin/tokens");
  redirect("/admin/tokens?ok=Token revoked.");
}

/** Number of redemptions still pending, used by the dashboard link. */
export async function countPendingRedemptions(): Promise<number> {
  const db = await getDb();
  const [row] = await db
    .select({ total: sql<string>`count(*)` })
    .from(redemptions)
    .where(eq(redemptions.status, "pending"));
  return Number(row?.total ?? 0);
}
