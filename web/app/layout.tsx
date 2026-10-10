import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";

import { AppHeader, MobileTabBar } from "@/components/shell/app-header";
import { Providers } from "@/components/shell/providers";
import { RecordSheet } from "@/components/record-sheet";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PlantMemory", template: "%s · PlantMemory" },
  description:
    "Find how a plant problem was solved before, by meaning, and draft a cited note for a person to review.",
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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <Providers>
          <AppHeader />
          <main className="mx-auto w-full max-w-[1240px] px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] sm:px-6 md:pb-16">
            {children}
          </main>
          <MobileTabBar />
          <RecordSheet />
        </Providers>
      </body>
    </html>
  );
}
