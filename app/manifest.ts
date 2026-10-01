import type { MetadataRoute } from "next";

/** Lets Safari (iPhone "Add to Home Screen", Mac "Add to Dock") and Chrome install Harbour as an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Harbour",
    short_name: "Harbour",
    description: "Budgets, savings goals, bills and cash flow in one place. A budgeting tool, not a bank.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#0f766e",
    lang: "en-CA",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
