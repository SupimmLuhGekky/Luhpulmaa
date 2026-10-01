import type { Metadata, Viewport } from "next";
import "react-day-picker/style.css";
import "./globals.css";
import { AppProviders } from "@/components/providers/app-providers";

export const metadata: Metadata = {
  title: { default: "Harbour — budgeting and money organisation", template: "%s · Harbour" },
  description: "See where your money goes, plan budgets and savings goals, and forecast your cash flow. Harbour is a budgeting tool, not a bank.",
  applicationName: "Harbour",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "Harbour", statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0d12" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The interface is written in English; a French locale setting only changes number and date formats.
  return (
    <html lang="en-CA" suppressHydrationWarning>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only z-[100] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
          Skip to content
        </a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
