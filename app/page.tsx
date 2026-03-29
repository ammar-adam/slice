import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="slice-page slice-dot-grid flex flex-col justify-between">
      <section className="pt-16">
        <p className="slice-logo text-xl">slice</p>
        <h1 className="slice-heading mt-8 text-5xl leading-[0.92]">
          <span className="block">wanna bet</span>
          <span className="block" style={{ color: "var(--slice-orange)" }}>
            your food is late?
          </span>
        </h1>
        <p className="mt-6 max-w-[34ch] text-base" style={{ color: "var(--slice-muted)", fontWeight: 300 }}>
          A prediction market for your delivery orders
        </p>
        <Link
          href="/create"
          className="slice-btn-primary mt-8 block w-full px-4 py-[14px] text-center"
        >
          Start betting
        </Link>

        <div className="mt-16 grid grid-cols-3 gap-6 text-center">
          {[
            { n: "01", label: "Order food" },
            { n: "02", label: "Share the bet" },
            { n: "03", label: "Watch odds move" },
          ].map((step) => (
            <div key={step.n}>
              <p className="slice-number text-3xl" style={{ color: "var(--slice-orange)" }}>
                {step.n}
              </p>
              <p className="mt-2 text-sm" style={{ color: "var(--slice-muted)" }}>
                {step.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div
        className="mb-8 text-center text-[12px]"
        style={{ color: "var(--slice-muted)", letterSpacing: "0.08em" }}
      >
        <span>AI-generated odds</span>
        <span style={{ color: "#ffffff20" }}> {" · "} </span>
        <span>Live market</span>
        <span style={{ color: "#ffffff20" }}> {" · "} </span>
        <span>Dare mode</span>
      </div>
    </main>
  );
}
