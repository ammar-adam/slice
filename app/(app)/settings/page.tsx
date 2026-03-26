export default function SettingsPage() {
  return (
    <main className="space-y-5">
      <h1 className="text-xl font-bold text-neutral-900">Settings</h1>
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
        <h2 className="text-sm font-semibold text-neutral-900">Gmail access</h2>
        <p className="mt-2 text-sm text-neutral-600">
          Slice uses read-only Gmail access to find delivery confirmations and
          resolve bets automatically. We only process delivery-related mail; no
          addresses are shown on public rankings.
        </p>
      </section>
    </main>
  );
}
