"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireReadyClientSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { redeemReward } from "@/lib/redeem";

/**
 * Portal server action for redeeming a reward.
 *
 * The customer id always comes from the session, never from the form, so changing
 * a hidden field or a URL cannot spend another customer's points. Only the reward
 * id is read from the submission.
 */
export async function redeemRewardAction(formData: FormData): Promise<void> {
  const session = await requireReadyClientSession();
  const rewardId = String(formData.get("rewardId") ?? "");

  if (!rewardId) {
    redirect("/portal/rewards?error=Choose a reward to redeem.");
  }

  const db = await getDb();
  const result = await redeemReward(db, {
    customerId: session.customerId,
    rewardId,
  });

  revalidatePath("/portal");
  revalidatePath("/portal/rewards");
  revalidatePath("/portal/redemptions");

  if (!result.ok) {
    redirect(`/portal/rewards?error=${encodeURIComponent(result.error)}`);
  }

  const message = result.code
    ? `Reward redeemed. Your coupon code is ${result.code}.`
    : "Reward redeemed. The store will contact you when it is delivered.";
  redirect(`/portal/redemptions?ok=${encodeURIComponent(message)}`);
}
