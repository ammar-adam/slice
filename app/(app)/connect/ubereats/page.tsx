import Link from "next/link";

export default function ConnectUberEatsPage() {
  return (
    <main className="mx-auto max-w-lg space-y-6 pb-24">
      <div className="slice-card slice-fade-up p-4">
        <h1 className="slice-heading text-2xl">Uber Eats connection</h1>
        <p className="mt-4 text-sm" style={{ color: "var(--slice-muted)" }}>
          Cookie-based connection is coming soon.
          For now, create a bet by pasting your order link on the{" "}
          <Link href="/create" className="underline" style={{ color: "var(--slice-orange)" }}>
            New bet
          </Link>{" "}
          page.
        </p>
      </div>

      <p className="text-center text-xs" style={{ color: "var(--slice-muted)" }}>
        <Link href="/home" className="underline">
          Back to home
        </Link>
      </p>
    </main>
  );
}
