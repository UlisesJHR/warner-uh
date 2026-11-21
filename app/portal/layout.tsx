import Link from "next/link";
import type { ReactNode } from "react";
import { clientLogoutAction } from "@/app/actions/auth";

/**
 * Portal shell.
 *
 * The layout is intentionally unguarded: the login screen lives inside it. Every
 * data page calls `requireReadyClientSession` itself, which keeps the guard next
 * to the data it protects.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/portal" className="brand">
            Store rewards
          </Link>
          <nav className="nav" aria-label="Portal sections">
            <Link href="/portal">Overview</Link>
            <Link href="/portal/rewards">Rewards</Link>
            <Link href="/portal/redemptions">My redemptions</Link>
          </nav>
          <form action={clientLogoutAction}>
            <button type="submit" className="button button-small">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="shell">{children}</main>
    </>
  );
}
