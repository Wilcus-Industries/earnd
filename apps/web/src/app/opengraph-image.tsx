import { ImageResponse } from "next/og";

// Site-wide social card. Next auto-wires this into og:image / twitter:image for
// every route (overridable per-route). Themed to match the dark "broadcast"
// palette: near-black canvas, signal-amber accent.
export const alt = "earnd — the terminal's top row is inventory";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CANVAS = "#0a0e0a";
const PANEL = "#0f140e";
const WIRE = "#1e241b";
const INK = "#e9e6da";
const INK_DIM = "#8a8f82";
const SIGNAL = "#ff7a1a";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: CANVAS,
          padding: "72px",
          fontFamily: "monospace",
        }}
      >
        {/* Top label: a faux on-air banner row */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "18px",
              height: "18px",
              borderRadius: "9999px",
              backgroundColor: SIGNAL,
            }}
          />
          <div
            style={{
              fontSize: "26px",
              letterSpacing: "8px",
              textTransform: "uppercase",
              color: INK_DIM,
            }}
          >
            terminal ad network
          </div>
        </div>

        {/* The thesis */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: "82px",
              fontWeight: 700,
              lineHeight: 1.04,
              color: INK,
            }}
          >
            The terminal&apos;s top row
          </div>
          <div style={{ display: "flex", fontSize: "82px", fontWeight: 700, lineHeight: 1.04 }}>
            <span style={{ color: INK }}>is&nbsp;</span>
            <span style={{ color: SIGNAL }}>inventory.</span>
          </div>
          <div style={{ marginTop: "28px", fontSize: "30px", color: INK_DIM, maxWidth: "900px" }}>
            One sanitized line, pinned above your prompt. The developer who runs the banner keeps 50%.
          </div>
        </div>

        {/* Footer: brand mark in a terminal-chrome strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            padding: "18px 28px",
            borderRadius: "12px",
            border: `1px solid ${WIRE}`,
            backgroundColor: PANEL,
            alignSelf: "flex-start",
          }}
        >
          <div style={{ fontSize: "40px", fontWeight: 700, color: SIGNAL }}>e</div>
          <div style={{ fontSize: "34px", fontWeight: 700, color: INK }}>earnd</div>
        </div>
      </div>
    ),
    size,
  );
}
