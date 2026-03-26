export default function OrdersPage() {
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold text-neutral-900">Orders</h1>
      <p className="text-sm text-neutral-600">
        Parsed delivery orders will list here after Gmail connect and ingest.
      </p>
      <div className="rounded-2xl border border-dashed border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500">
        No orders yet
      </div>
    </main>
  );
}
