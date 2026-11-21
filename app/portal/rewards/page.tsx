import Image from "next/image";
import { Alert, EmptyRow, LevelBadge, PageHeader } from "@/components/ui";
import { redeemRewardAction } from "@/app/actions/portal";
import { requireReadyClientSession } from "@/lib/auth";
import { getPortalCatalog } from "@/lib/queries";
import { formatCents } from "@/lib/loyalty";

/**
 * Reward catalogue for the signed-in customer.
 *
 * Eligibility is displayed as text next to each reward, and the server action
 * repeats every validation inside the transaction. A disabled button here is only
 * an explanation, never the rule itself.
 */
export default async function PortalRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requireReadyClientSession();
  const { error, ok } = await searchParams;
  const catalog = await getPortalCatalog(session.customerId);

  return (
    <>
      <PageHeader
        title="Rewards"
        description={`You have ${catalog.availablePoints.toLocaleString("en-US")} points available.`}
      />
      {ok ? <Alert kind="success">{ok}</Alert> : null}
      {error ? <Alert kind="error">{error}</Alert> : null}

      {catalog.items.length === 0 ? (
        <div className="card">
          <EmptyRow colSpan={1}>The catalogue is empty right now. Check back soon.</EmptyRow>
        </div>
      ) : (
        <ul
          className="grid"
          style={{ listStyle: "none", padding: 0, margin: 0 }}
          aria-label="Reward catalogue"
        >
          {catalog.items.map((item) => {
            const reason = !item.inStock
              ? "Out of stock"
              : !item.meetsLevel
                ? `Requires the ${item.minLevel} level`
                : !item.affordable
                  ? `Needs ${(item.pointsCost - catalog.availablePoints).toLocaleString("en-US")} more points`
                  : null;

            return (
              <li key={item.id} className="card stack" style={{ gap: "0.5rem" }}>
                {item.imageUrl ? (
                  <Image
                    src={item.imageUrl}
                    alt={item.name}
                    width={480}
                    height={270}
                    sizes="(max-width: 720px) 100vw, 30vw"
                    style={{ inlineSize: "100%", blockSize: "auto", borderRadius: "0.5rem" }}
                  />
                ) : null}
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h2>{item.name}</h2>
                  <span className="badge badge-accent">
                    {item.pointsCost.toLocaleString("en-US")} pts
                  </span>
                </div>
                <p className="muted">{item.description}</p>
                <div className="row">
                  <LevelBadge level={item.minLevel} />
                  <span className="muted">
                    {item.stock === null ? "Unlimited" : `${item.stock} left`}
                  </span>
                  {item.perCustomerLimit ? (
                    <span className="muted">Limit {item.perCustomerLimit} per customer</span>
                  ) : null}
                </div>
                {item.kind === "discount" ? (
                  <p className="muted">
                    {item.discountType === "percentage"
                      ? `${(item.discountValueCents ?? 0) / 100}% off`
                      : `$${formatCents(item.discountValueCents ?? 0)} off`}
                    {item.minPurchaseCents
                      ? ` on purchases over $${formatCents(item.minPurchaseCents)}`
                      : ""}
                    {item.validDays ? `, valid ${item.validDays} days` : ""}
                  </p>
                ) : null}

                <form action={redeemRewardAction}>
                  <input type="hidden" name="rewardId" value={item.id} />
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={reason !== null}
                  >
                    Redeem
                  </button>
                </form>
                {reason ? <p className="muted">{reason}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
