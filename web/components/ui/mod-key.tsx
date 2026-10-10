"use client";

import { useSyncExternalStore } from "react";

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "⌘" on Apple devices, "Ctrl" elsewhere. Renders "⌘" during prerender. */
export function ModKey() {
  const mac = useSyncExternalStore(
    () => () => {},
    isMac,
    () => true,
  );
  return <>{mac ? "⌘" : "Ctrl"}</>;
}
