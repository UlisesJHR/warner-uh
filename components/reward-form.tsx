import { CheckboxField, Field, SelectField } from "@/components/ui";
import { saveRewardAction } from "@/app/actions/admin";

/**
 * Shared create and edit form for a reward.
 *
 * Discount specific fields stay visible with an explanation instead of appearing
 * conditionally, because a conditional form would need client JavaScript. The
 * server action ignores them for products.
 */
export function RewardForm({
  reward,
}: {
  reward?: {
    id: string;
    name: string;
    description: string;
    kind: string;
    pointsCost: number;
    stock: number | null;
    minLevel: string;
    perCustomerLimit: number | null;
    active: boolean;
    imageUrl: string | null;
    discountType: string | null;
    discountValueCents: number | null;
    minPurchaseCents: number | null;
    validDays: number | null;
  } | null;
}) {
  return (
    <form action={saveRewardAction} className="form">
      {reward ? <input type="hidden" name="id" value={reward.id} /> : null}

      <Field label="Name" name="name" required defaultValue={reward?.name} />
      <Field
        label="Description"
        name="description"
        defaultValue={reward?.description}
        hint="Shown to customers in the portal catalogue."
      />
      <SelectField
        label="Type"
        name="kind"
        required
        defaultValue={reward?.kind ?? "product"}
        options={[
          { value: "product", label: "Product (needs delivery)" },
          { value: "discount", label: "Discount (generates a coupon)" },
        ]}
      />
      <Field
        label="Points required"
        name="pointsCost"
        type="number"
        min={1}
        required
        defaultValue={reward?.pointsCost ?? 500}
      />
      <Field
        label="Stock"
        name="stock"
        type="number"
        min={0}
        defaultValue={reward?.stock ?? ""}
        hint="Leave empty for unlimited stock. Discounts are usually unlimited."
      />
      <SelectField
        label="Minimum level"
        name="minLevel"
        required
        defaultValue={reward?.minLevel ?? "Bronce"}
        options={[
          { value: "Bronce", label: "Bronce" },
          { value: "Plata", label: "Plata" },
          { value: "Oro", label: "Oro" },
        ]}
      />
      <Field
        label="Limit per customer"
        name="perCustomerLimit"
        type="number"
        min={1}
        defaultValue={reward?.perCustomerLimit ?? ""}
        hint="Leave empty for no per customer limit."
      />

      <fieldset className="stack" style={{ border: "1px solid var(--border)", borderRadius: "0.75rem", padding: "1rem" }}>
        <legend>Discount settings</legend>
        <p className="muted">Used only when the type is discount.</p>
        <SelectField
          label="Discount type"
          name="discountType"
          defaultValue={reward?.discountType ?? "percentage"}
          options={[
            { value: "percentage", label: "Percentage off" },
            { value: "amount", label: "Fixed amount off (MXN)" },
          ]}
        />
        <Field
          label="Discount value"
          name="discountValue"
          type="number"
          min={1}
          step="any"
          defaultValue={
            reward?.discountValueCents
              ? reward.discountType === "percentage"
                ? reward.discountValueCents / 100
                : reward.discountValueCents / 100
              : ""
          }
          hint="Percentage: 10 means 10% off. Amount: 200 means 200 MXN off."
        />
        <Field
          label="Minimum purchase (MXN)"
          name="minPurchase"
          type="number"
          min={0}
          step="any"
          defaultValue={reward?.minPurchaseCents ? reward.minPurchaseCents / 100 : ""}
          hint="Optional. Leave empty for no minimum."
        />
        <Field
          label="Coupon validity in days"
          name="validDays"
          type="number"
          min={1}
          defaultValue={reward?.validDays ?? 30}
          hint="Days between the redemption and the coupon expiry."
        />
      </fieldset>

      <div className="field">
        <label htmlFor="field-image">Photo</label>
        <span className="hint" id="field-image-hint">
          PNG, JPEG, WebP or GIF up to 4 MB. The file is stored in object storage, never in the
          database.
        </span>
        <input
          id="field-image"
          name="image"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-describedby="field-image-hint"
        />
      </div>
      <Field
        label="Or an image URL"
        name="imageUrl"
        type="url"
        defaultValue={reward?.imageUrl ?? ""}
        hint="Paste an existing public image URL instead of uploading a file."
      />

      <CheckboxField label="Active in the catalogue" name="active" defaultChecked={reward?.active ?? true} />

      <button type="submit" className="button button-primary">
        {reward ? "Save reward" : "Create reward"}
      </button>
    </form>
  );
}
