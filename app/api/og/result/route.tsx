import { ImageResponse } from "@vercel/og";

export const runtime = "edge";

export async function GET() {
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
          background: "#ffffff",
          color: "#171717",
          fontSize: 48,
          fontWeight: 700,
        }}
      >
        <div style={{ color: "#ff5a1f" }}>Slice</div>
        <div style={{ marginTop: 16, fontSize: 28 }}>Result card placeholder</div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
