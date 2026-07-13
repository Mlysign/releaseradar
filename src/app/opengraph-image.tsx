import { ImageResponse } from "next/og";

// P12 — dynamic Open Graph / Twitter card image (1200×630). Next wires this file
// convention into both openGraph.images and twitter.images automatically.
// Deliberately simple (satori supports flexbox + a CSS subset only).

export const alt = "ReleaseRadar — one calendar for every game, movie & show";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TAGLINE = "One calendar for every game, movie, and show you're waiting for.";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a0a0a 0%, #1e1b4b 100%)",
          color: "#fafafa",
          fontFamily: "sans-serif",
          padding: "0 100px",
        }}
      >
        <div style={{ display: "flex", fontSize: 100, fontWeight: 800, letterSpacing: "-3px" }}>
          ReleaseRadar
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 38,
            color: "#a5b4fc",
            marginTop: 28,
            textAlign: "center",
            lineHeight: 1.3,
          }}
        >
          {TAGLINE}
        </div>
      </div>
    ),
    size,
  );
}
