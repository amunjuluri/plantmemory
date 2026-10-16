"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { api } from "@/lib/api";
import { installErrorHandlers, isNewVisitor, startGoogleAnalytics, track } from "@/lib/telemetry";

/** Opens the app's telemetry: who arrived (a random id, not a person), each page they
 * open, and any error the page didn't catch. Google Analytics too when it is set up. */
export function Telemetry() {
  const pathname = usePathname();
  const opened = useRef(false);

  useEffect(() => {
    const remove = installErrorHandlers();
    api.config().then(
      (config) => config.analytics_measurement_id && startGoogleAnalytics(config.analytics_measurement_id),
      () => undefined,
    );
    return remove;
  }, []);

  useEffect(() => {
    if (!opened.current) {
      opened.current = true;
      const touch = window.matchMedia("(pointer: coarse)").matches;
      track("app_open", {
        new_visitor: isNewVisitor(),
        referrer: document.referrer ? new URL(document.referrer).host : null,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        device: touch ? (window.innerWidth < 768 ? "phone" : "tablet") : "desktop",
        dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
        language: navigator.language,
        // A rough place (e.g. Asia/Kolkata) without an IP lookup.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    }
    track("page_view", { title: document.title });
    window.gtag?.("event", "page_view", { page_location: window.location.href, page_title: document.title });
  }, [pathname]);

  return null;
}
