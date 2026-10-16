"use client";

import { ThemeProvider, useTheme } from "next-themes";
import { useEffect } from "react";
import { Toaster } from "sonner";

import { useSession } from "@/lib/stores/session";
import { Telemetry } from "./telemetry";

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      // Above the phone tab bar and any action bar (see --bottom-chrome in globals.css).
      offset={{ bottom: "calc(max(var(--bottom-chrome), var(--action-bar)) + 16px)" }}
      mobileOffset={{ bottom: "calc(max(var(--bottom-chrome), var(--action-bar)) + 12px)" }}
      toastOptions={{ className: "!font-sans" }}
    />
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void useSession.persist.rehydrate();
  }, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <ThemedToaster />
      <Telemetry />
    </ThemeProvider>
  );
}
