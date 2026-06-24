import type { MetadataRoute } from "next";
import { DEFAULT_DESCRIPTION, SITE_NAME } from "@/lib/seo";

// PWA / install metadata. Colors match the dark "broadcast" theme
// (canvas #0a0e0a, signal-amber #ff7a1a) from globals.css.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "earnd — terminal ad network",
    short_name: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#0a0e0a",
    theme_color: "#ff7a1a",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
    ],
  };
}
