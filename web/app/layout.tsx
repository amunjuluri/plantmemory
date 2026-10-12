import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { Noto_Sans_Devanagari, Noto_Sans_Telugu } from "next/font/google";

import { AppHeader, MobileTabBar } from "@/components/shell/app-header";
import { Providers } from "@/components/shell/providers";
import { RecordSheet } from "@/components/record-sheet";

import "./globals.css";

// Printed guides carry Telugu and Hindi text; these render them the same on every machine.
// Not preloaded: each is 120 KB and the browser fetches it only when that script is on the
// page (the font's unicode-range), so English screens load faster on a phone.
const telugu = Noto_Sans_Telugu({
  subsets: ["telugu"],
  variable: "--font-telugu",
  display: "swap",
  preload: false,
});
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-devanagari",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: { default: "PlantMemory", template: "%s · PlantMemory" },
  description:
    "When a machine stops, give the manager a cited repair guide from past fixes and manuals, approved by QA and printed in the workers' language.",
  applicationName: "PlantMemory",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fafb" },
    { media: "(prefers-color-scheme: dark)", color: "#16181c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${telugu.variable} ${devanagari.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh">
        <Providers>
          <AppHeader />
          <main className="mx-auto w-full max-w-[1240px] px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] sm:px-6 md:pb-16 print:max-w-none print:p-0">
            {children}
          </main>
          <MobileTabBar />
          <RecordSheet />
        </Providers>
      </body>
    </html>
  );
}
