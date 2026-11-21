import Link from "next/link";
import type { ReactNode } from "react";
import { staffLogoutAction } from "@/app/actions/auth";
import { hasPermission, requireStaffSession } from "@/lib/auth";

/**
 * Panel shell.
 *
 * The layout guards every child route on the server and only renders the links the
 * current role can use. The links are a convenience: each page and action still
 * checks its own permission, so hiding a link is never the access control.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireStaffSession();

  const links: { href: string; label: string; visible: boolean }[] = [
    { href: "/admin", label: "Dashboard", visible: hasPermission(session, "dashboard:view") },
    { href: "/admin/customers", label: "Customers", visible: hasPermission(session, "customers:read") },
    { href: "/admin/risk", label: "At risk", visible: hasPermission(session, "lists:view") },
    { href: "/admin/birthdays", label: "Birthdays", visible: hasPermission(session, "lists:view") },
    { href: "/admin/rewards", label: "Rewards", visible: hasPermission(session, "rewards:manage") },
    {
      href: "/admin/redemptions",
      label: "Redemptions",
      visible: hasPermission(session, "redemptions:manage"),
    },
    { href: "/admin/users", label: "Users", visible: hasPermission(session, "users:manage") },
    { href: "/admin/roles", label: "Roles", visible: hasPermission(session, "roles:manage") },
    { href: "/admin/tokens", label: "API tokens", visible: hasPermission(session, "tokens:manage") },
    { href: "/admin/sync", label: "Synchronisation", visible: hasPermission(session, "sync:run") },
  ];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/admin" className="brand">
            Loyalty panel
          </Link>
          <nav className="nav" aria-label="Panel sections">
            {links
              .filter((link) => link.visible)
              .map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
          </nav>
          <div className="row">
            <span className="muted">
              {session.name} · {session.roleName}
            </span>
            <form action={staffLogoutAction}>
              <button type="submit" className="button button-small">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="shell">{children}</main>
    </>
  );
}
