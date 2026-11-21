import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, PageHeader } from "@/components/ui";
import { RewardForm } from "@/components/reward-form";
import { requirePermission } from "@/lib/auth";
import { getReward } from "@/lib/queries";

/** Edit an existing reward. */
export default async function EditRewardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requirePermission("rewards:manage");
  const { id } = await params;
  const { ok, error } = await searchParams;
  const reward = await getReward(id);

  if (!reward) {
    notFound();
  }

  return (
    <>
      <PageHeader
        title={`Edit ${reward.name}`}
        description="Changes apply to new redemptions immediately."
        actions={
          <Link href="/admin/rewards" className="button button-small">
            Back to rewards
          </Link>
        }
      />
      {ok ? <Alert kind="success">{ok}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div style={{ marginBlockStart: "1rem" }}>
        <RewardForm reward={reward} />
      </div>
    </>
  );
}
