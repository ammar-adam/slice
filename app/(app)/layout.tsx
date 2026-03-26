import Link from "next/link";

import { SignOutButton } from "@/components/ui/sign-out-button";
import { getSession } from "@/lib/auth/session";

export default async function AppLayout(props: { children: React.ReactNode }) {
  const session = await getSession();

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-10 pt-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <Link href="/home" className="text-sm font-bold text-slice-primary">
          Slice
        </Link>
        <nav className="flex items-center gap-3 text-xs font-medium text-neutral-600">
          <Link href="/orders" className="hover:text-neutral-900">
            Orders
          </Link>
          <Link href="/rankings" className="hover:text-neutral-900">
            Rankings
          </Link>
          <Link href="/settings" className="hover:text-neutral-900">
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
