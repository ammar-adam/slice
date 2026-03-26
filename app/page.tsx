import Link from "next/link";

import { SignInCTA } from "@/components/marketing/sign-in-cta";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-5 py-14">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slice-primary">
          Slice
        </p>
        <h1 className="text-3xl font-bold leading-tight text-neutral-900">
          Turn waiting for food into a group chat game.
        </h1>
        <p className="text-base text-neutral-600">
          Bet over/under on whether your delivery lands on time — no money, just
          dares, streaks, and screenshots.
        </p>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <p className="mb-4 text-sm text-neutral-600">
          Connect Gmail once. We read your delivery receipts, you get a shareable
          link for the group.
        </p>
        <SignInCTA />
      </div>

      <div className="flex gap-4 text-sm">
        <Link
          href="/rankings"
          className="font-medium text-slice-primary underline-offset-4 hover:underline"
        >
          Restaurant rankings
        </Link>
        <Link
          href="/home"
          className="font-medium text-neutral-500 underline-offset-4 hover:underline"
        >
          Dashboard
        </Link>
      </div>
    </main>
  );
}
