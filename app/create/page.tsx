import Link from "next/link";
import { redirect } from "next/navigation";

import { CreateBetPageForm } from "@/components/bets/create-bet-page-form";
import { getSession } from "@/lib/auth/session";

export default async function CreateBetPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect("/");
  }

  return (
    <main className="slice-page">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/home" className="slice-logo text-[26px] leading-none">
          slice
        </Link>
      </header>
      <CreateBetPageForm />
    </main>
  );
}
