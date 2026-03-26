import { ImageResponse } from "@vercel/og";

export const runtime = "edge";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const title = url.searchParams.get("title") ?? "Slice";
  const subtitle = url.searchParams.get("subtitle") ?? "Delivery result";
  const accent = url.searchParams.get("accent") ?? "#ff5a1f";
  const badge = url.searchParams.get("badge") ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg,#ffffff 0%, #fff7ed 100%)",
          color: "#171717",
          fontSize: 54,
          fontWeight: 800,
          padding: 64,
        }}
      >
        <div
          style={{
            width: "100%",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            fontWeight: 700,
            color: accent,
            opacity: 0.95,
          }}
        >
          <div>Slice</div>
          {badge ? (
            <div
              style={{
                padding: "10px 16px",
                borderRadius: 999,
                background: "#111827",
                color: "#ffffff",
                fontSize: 18,
              }}
            >
              {badge}
            </div>
          ) : (
            <div />
          )}
        </div>

        <div
          style={{
            marginTop: 28,
            width: "100%",
            borderRadius: 48,
            background: "#ffffff",
            border: "1px solid rgba(0,0,0,0.06)",
            boxShadow: "0 20px 60px rgba(17,24,39,0.12)",
            padding: 48,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ fontSize: 60, fontWeight: 900, lineHeight: 1.05 }}>
            {title}
          </div>
          <div style={{ fontSize: 28, fontWeight: 600, color: "#4b5563" }}>
            {subtitle}
          </div>

          <div
            style={{
              marginTop: 18,
              height: 10,
              width: "100%",
              borderRadius: 999,
              background: "rgba(0,0,0,0.06)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: "70%",
                borderRadius: 999,
                background: `linear-gradient(90deg, ${accent}, #ea580c)`,
              }}
            />
          </div>

          <div
            style={{
              marginTop: 16,
              display: "flex",
              justifyContent: "space-between",
              fontSize: 20,
              color: "#6b7280",
            }}
          >
            <div>Share the result</div>
            <div style={{ color: "#111827", fontWeight: 700 }}>slice.app</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
