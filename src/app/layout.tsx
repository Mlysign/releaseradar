import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppProviders from "@/components/ui/AppProviders";
import { BASE_URL } from "@/lib/baseUrl";

const inter = Inter({ subsets: ["latin"] });

const TITLE = "ReleaseRadar — one calendar for every game, movie & show";
const DESCRIPTION =
  "One calendar for every game, movie, and show you're waiting for. Track upcoming releases across Trakt, Steam, TMDB and more.";

// P12 — SEO metadata. metadataBase makes OG/sitemap URLs absolute; the title
// template lets authed pages set just their name (e.g. "Library · ReleaseRadar").
export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: { default: TITLE, template: "%s · ReleaseRadar" },
  description: DESCRIPTION,
  applicationName: "ReleaseRadar",
  keywords: [
    "release calendar", "game releases", "movie releases", "TV show releases",
    "upcoming games", "upcoming movies", "watchlist", "Trakt", "Steam", "TMDB",
  ],
  openGraph: {
    type: "website",
    siteName: "ReleaseRadar",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          data-* attributes on <body> before hydration, causing a benign mismatch. */}
      <body suppressHydrationWarning className={`${inter.className} bg-neutral-950 text-neutral-100 min-h-screen`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
