import Link from "next/link";
import { PageHeader } from "@/components/ui";

/**
 * Shown when a signed-in user opens a screen their role cannot use.
 *
 * It is a page instead of a silent redirect so the reason is explicit.
 */
export default function ForbiddenPage() {
  return (
    <>
      <PageHeader
        title="Not available for your role"
        description="Your role does not include the permission this screen requires."
      />
      <p>
        <Link href="/admin" className="button">
          Back to the dashboard
        </Link>
      </p>
    </>
  );
}
