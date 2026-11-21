import { PageHeader } from "@/components/ui";
import { RewardForm } from "@/components/reward-form";
import { requirePermission } from "@/lib/auth";

/** Create a reward. The form is shared with the edit screen. */
export default async function NewRewardPage() {
  await requirePermission("rewards:manage");
  return (
    <>
      <PageHeader
        title="New reward"
        description="Customers see active rewards they qualify for, ordered by points cost."
      />
      <RewardForm />
    </>
  );
}
