import Link from "next/link";

import { SignOutButton } from "@/components/ui/sign-out-button";
import { getSession } from "@/lib/auth/session";

export default async function AppLayout(props: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <div className="slice-page">
      <header className="mb-6 flex items-center justify-between gap-3">
        <Link href="/home" className="slice-logo text-[26px] leading-none">
          slice
        </Link>
        <nav className="flex items-center gap-3 text-xs" style={{ color: "var(--slice-muted)" }}>
          <Link href="/orders" className="transition-colors duration-150 hover:text-[var(--slice-text)]">
            Orders
          </Link>
          <Link href="/rankings" className="transition-colors duration-150 hover:text-[var(--slice-text)]">
            Rankings
          </Link>
          <Link
            href="/connect/ubereats"
            className="transition-colors duration-150 hover:text-[var(--slice-text)]"
          >
            Uber
          </Link>
          <Link href="/settings" className="transition-colors duration-150 hover:text-[var(--slice-text)]">
            Settings
          </Link>
          {session?.user?.email ? (
            <SignOutButton />
          ) : null}
        </nav>
      </header>
      {props.children}
    </div>
  );
}
