import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import {
  Noto_Nastaliq_Urdu,
  Noto_Sans_Bengali,
  Noto_Sans_Devanagari,
  Noto_Sans_Gujarati,
  Noto_Sans_Gurmukhi,
  Noto_Sans_Kannada,
  Noto_Sans_Malayalam,
  Noto_Sans_Oriya,
  Noto_Sans_Tamil,
  Noto_Sans_Telugu,
} from "next/font/google";

import { Tour } from "@/components/onboarding/tour";
import { AppHeader, MobileTabBar } from "@/components/shell/app-header";
import { Providers } from "@/components/shell/providers";
import { RecordSheet } from "@/components/record-sheet";

import "./globals.css";

// Printed guides carry text in Indian scripts; these render it the same on every machine.
// Not preloaded: each is about 120 KB and the browser fetches one only when its script is
// on the page (the font's unicode-range), so English screens load faster on a phone.
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
const tamil = Noto_Sans_Tamil({ subsets: ["tamil"], variable: "--font-tamil", display: "swap", preload: false });
const kannada = Noto_Sans_Kannada({ subsets: ["kannada"], variable: "--font-kannada", display: "swap", preload: false });
const malayalam = Noto_Sans_Malayalam({
  subsets: ["malayalam"],
  variable: "--font-malayalam",
  display: "swap",
  preload: false,
});
// Bengali script also covers Assamese.
const bengali = Noto_Sans_Bengali({ subsets: ["bengali"], variable: "--font-bengali", display: "swap", preload: false });
const gujarati = Noto_Sans_Gujarati({
  subsets: ["gujarati"],
  variable: "--font-gujarati",
  display: "swap",
  preload: false,
});
const gurmukhi = Noto_Sans_Gurmukhi({
  subsets: ["gurmukhi"],
  variable: "--font-gurmukhi",
  display: "swap",
  preload: false,
});
const oriya = Noto_Sans_Oriya({ subsets: ["oriya"], variable: "--font-oriya", display: "swap", preload: false });
const urdu = Noto_Nastaliq_Urdu({ subsets: ["arabic"], variable: "--font-urdu", display: "swap", preload: false });
const scripts = [telugu, devanagari, tamil, kannada, malayalam, bengali, gujarati, gurmukhi, oriya, urdu];

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
      className={[GeistSans.variable, GeistMono.variable, ...scripts.map((f) => f.variable)].join(" ")}
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
          <Tour />
        </Providers>
      </body>
    </html>
  );
}
