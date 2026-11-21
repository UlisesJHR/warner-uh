import { eq } from "drizzle-orm";
import { ROLE_PRESETS } from "../lib/constants";
import { hashPassword } from "../lib/auth";
import { closeDb, getDb } from "../lib/db";
import { rewards, roles, staffUsers } from "../lib/db/schema";

/**
 * Seed the minimum data the panel needs to be usable.
 *
 * Only the three preset roles, one staff account per role and a small reward
 * catalogue are created. Passwords come from the environment, are hashed here and
 * are never written into the repository. Re-running the script is safe: existing
 * roles and users are left untouched.
 */
try {
  process.loadEnvFile?.(".env");
} catch {
  // Seeding without .env is allowed; the embedded database and defaults are used.
}

async function seedRoles(db: Awaited<ReturnType<typeof getDb>>): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [name, preset] of Object.entries(ROLE_PRESETS)) {
    const [existing] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, name))
      .limit(1);
    if (existing) {
      ids.set(name, existing.id);
      continue;
    }
    const [created] = await db
      .insert(roles)
      .values({
        name,
        description: preset.description,
        permissions: [...preset.permissions],
        isSystem: true,
      })
      .returning({ id: roles.id });
    ids.set(name, created.id);
  }
  return ids;
}

async function seedStaff(
  db: Awaited<ReturnType<typeof getDb>>,
  roleIds: Map<string, string>,
  input: { name: string; emailVar: string; passwordVar: string; role: string },
): Promise<void> {
  const email = process.env[input.emailVar]?.trim().toLowerCase();
  const password = process.env[input.passwordVar];
  if (!email || !password) {
    console.log(`Skipped ${input.role}: set ${input.emailVar} and ${input.passwordVar}.`);
    return;
  }
  const roleId = roleIds.get(input.role);
  if (!roleId) {
    return;
  }
  const [existing] = await db
    .select({ id: staffUsers.id })
    .from(staffUsers)
    .where(eq(staffUsers.email, email))
    .limit(1);
  if (existing) {
    console.log(`Staff account already exists: ${email}`);
    return;
  }
  await db.insert(staffUsers).values({
    email,
    name: input.name,
    passwordHash: await hashPassword(password),
    roleId,
  });
  console.log(`Created ${input.role} account: ${email}`);
}

async function seedRewards(db: Awaited<ReturnType<typeof getDb>>): Promise<void> {
  const [existing] = await db.select({ id: rewards.id }).from(rewards).limit(1);
  if (existing) {
    return;
  }
  await db.insert(rewards).values([
    {
      name: "Canvas tote bag",
      description: "A branded tote bag from the online store.",
      kind: "product",
      pointsCost: 1500,
      stock: 25,
      minLevel: "Bronce",
      perCustomerLimit: 1,
    },
    {
      name: "10% off your next order",
      description: "A coupon worth 10% off, valid for 30 days after redemption.",
      kind: "discount",
      pointsCost: 800,
      stock: null,
      minLevel: "Bronce",
      discountType: "percentage",
      // For percentage discounts this field holds hundredths of a percent.
      discountValueCents: 1000,
      validDays: 30,
    },
    {
      name: "200 MXN off",
      description: "A 200 MXN coupon on purchases over 1,000 MXN.",
      kind: "discount",
      pointsCost: 2500,
      stock: 50,
      minLevel: "Plata",
      discountType: "amount",
      discountValueCents: 20000,
      minPurchaseCents: 100000,
      validDays: 45,
    },
    {
      name: "Premium gift box",
      description: "Limited edition box, delivered by the store team.",
      kind: "product",
      pointsCost: 6000,
      stock: 5,
      minLevel: "Oro",
      perCustomerLimit: 1,
    },
  ]);
  console.log("Created the starter reward catalogue.");
}

async function main(): Promise<void> {
  const db = await getDb();
  const roleIds = await seedRoles(db);
  await seedStaff(db, roleIds, {
    name: "Administrator",
    emailVar: "ADMIN_EMAIL",
    passwordVar: "ADMIN_PASSWORD",
    role: "Administrator",
  });
  await seedStaff(db, roleIds, {
    name: "Store Manager",
    emailVar: "MANAGER_EMAIL",
    passwordVar: "MANAGER_PASSWORD",
    role: "Manager",
  });
  await seedStaff(db, roleIds, {
    name: "Support Agent",
    emailVar: "SUPPORT_EMAIL",
    passwordVar: "SUPPORT_PASSWORD",
    role: "Customer Support",
  });
  await seedRewards(db);
  await closeDb();
  console.log("Seed finished.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
