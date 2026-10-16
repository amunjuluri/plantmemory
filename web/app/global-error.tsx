"use client";

import { useEffect } from "react";

import { reportError } from "@/lib/telemetry";

/** The whole app failed (even the header). It renders its own document, without the app's
 * styles, so it is styled inline and follows the system's light or dark mode. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError(error, { kind: "root", fatal: true, digest: error.digest });
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          colorScheme: "light dark",
          background: "Canvas",
          color: "CanvasText",
        }}
      >
        <title>PlantMemory</title>
        <main style={{ maxWidth: 420, padding: 24 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>PlantMemory stopped working</h1>
          <p style={{ opacity: 0.75, lineHeight: 1.5 }}>
            It has been reported to us automatically. Your guides and records are safe.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ font: "inherit", padding: "8px 14px", borderRadius: 10, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
