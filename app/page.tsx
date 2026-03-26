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
      </section>

      <div className="mb-8 grid grid-cols-3 gap-2">
        {["AI-generated odds", "Live market", "Dare mode"].map((item, i) => (
          <div
            key={item}
            className="slice-card slice-fade-up px-2 py-3 text-center text-[11px]"
            style={{
              color: "var(--slice-text)",
              animationDelay: `${i * 80}ms`,
            }}
          >
            {item}
          </div>
        ))}
      </div>
    </main>
  );
}
