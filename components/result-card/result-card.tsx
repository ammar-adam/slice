type Props = {
  winnerName: string;
  loserName: string;
  dareText?: string | null;
};

/** Screenshot-first layout — polish Sat milestone */
export function ResultCard(props: Props) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-lg ring-1 ring-black/5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slice-primary">
        Result
      </p>
      <p className="mt-4 text-3xl font-black leading-none text-neutral-900">
        {props.winnerName}
      </p>
      <p className="mt-2 text-sm text-neutral-500">{props.loserName}</p>
      {props.dareText ? (
        <p className="mt-4 rounded-2xl bg-neutral-50 p-3 text-sm text-neutral-800 ring-1 ring-neutral-100">
          {props.dareText}
        </p>
      ) : null}
    </div>
  );
}
