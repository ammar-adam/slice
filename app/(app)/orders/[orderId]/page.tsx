type Props = { params: { orderId: string } };

export default function OrderDetailPage(props: Props) {
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-bold text-neutral-900">Order</h1>
      <p className="text-xs text-neutral-500">{props.params.orderId}</p>
      <p className="text-sm text-neutral-600">
        Bet creation and model odds wire to this route in Thu milestone.
      </p>
    </main>
  );
}
