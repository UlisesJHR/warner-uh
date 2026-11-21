import Link from "next/link";
import type { ReactNode } from "react";
import { formatCents } from "@/lib/loyalty";

/**
 * Shared server-rendered UI pieces.
 *
 * There are deliberately no client components: every screen is a form that posts
 * to a server action, so the app works with JavaScript disabled and the server
 * stays the only place where permissions are enforced.
 */

/** Heading block for a page, with optional actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="stack" style={{ gap: "0.25rem" }}>
        <h1>{title}</h1>
        {description ? <p className="muted">{description}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

/** A single headline number with its label and an optional hint. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="card stat">
      <span className="muted">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="muted">{hint}</span> : null}
    </div>
  );
}

/** Notification block. `role="alert"` makes errors announced immediately. */
export function Alert({ kind, children }: { kind: "error" | "success"; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

/** Colour independent badge for the loyalty level. */
export function LevelBadge({ level }: { level: string }) {
  return <span className="badge badge-accent">{level}</span>;
}

/** Badge for redemption and coupon statuses, with readable English labels. */
export function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: "Pending",
    delivered: "Delivered",
    cancelled: "Cancelled",
    valid: "Valid",
    used: "Used",
    expired: "Expired",
    running: "Running",
    success: "Success",
    failed: "Failed",
  };
  const tone =
    status === "delivered" || status === "valid" || status === "success"
      ? "badge-success"
      : status === "cancelled" || status === "expired" || status === "failed"
        ? "badge-danger"
        : "";
  return <span className={`badge ${tone}`}>{labels[status] ?? status}</span>;
}

/** Money in MXN, always with two decimals. */
export function Money({ cents }: { cents: number }) {
  return <span className="num">${formatCents(cents)}</span>;
}

/**
 * Scrollable table region.
 *
 * `tabindex` plus `role="region"` lets keyboard users scroll a wide table, and the
 * accessible name explains what the region contains.
 */
export function TableRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-wrapper" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** Empty state row that spans the whole table. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td className="empty" colSpan={colSpan}>
        {children}
      </td>
    </tr>
  );
}

/**
 * Labelled field.
 *
 * The label always precedes the control, hints stay visible instead of being
 * hidden in a placeholder, and required fields are marked in text.
 */
export function Field({
  label,
  name,
  type = "text",
  required = false,
  hint,
  defaultValue,
  autoComplete,
  placeholder,
  min,
  max,
  step,
  pattern,
  inputMode,
  minLength,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  hint?: string;
  defaultValue?: string | number;
  autoComplete?: string;
  placeholder?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  pattern?: string;
  inputMode?: "numeric" | "text" | "decimal" | "email";
  minLength?: number;
  maxLength?: number;
}) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? (
          <>
            {" "}
            <span className="required" aria-hidden="true">
              *
            </span>
            <span className="visually-hidden">(required)</span>
          </>
        ) : null}
      </label>
      {hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        pattern={pattern}
        minLength={minLength}
        maxLength={maxLength}
        inputMode={inputMode}
        aria-describedby={hintId}
        // Keep identifiers out of autocorrect and spellcheck.
        autoCorrect={type === "email" ? "off" : undefined}
        autoCapitalize={type === "email" ? "none" : undefined}
        spellCheck={type === "email" ? false : undefined}
      />
    </div>
  );
}

/** Select field with the same labelling rules as `Field`. */
export function SelectField({
  label,
  name,
  options,
  defaultValue,
  hint,
  required = false,
}: {
  label: string;
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  hint?: string;
  required?: boolean;
}) {
  const id = `field-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span className="required"> *</span> : null}
      </label>
      {hint ? (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      <select id={id} name={name} defaultValue={defaultValue} required={required} aria-describedby={hintId}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Checkbox with its label after the control, as forms guidance recommends. */
export function CheckboxField({
  label,
  name,
  defaultChecked,
  value = "on",
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  value?: string;
}) {
  const id = `field-${name}-${value}`;
  return (
    <div className="checkbox-field">
      <input
        id={id}
        name={name}
        type="checkbox"
        value={value}
        defaultChecked={defaultChecked}
      />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

/** Primary navigation link that marks the active section. */
export function NavLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      {children}
    </Link>
  );
}
