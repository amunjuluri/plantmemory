"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Animates its height to fit its content, so swapping what is inside doesn't jump. */
export function AutoHeight({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={cn("overflow-hidden transition-[height] duration-300 ease-(--ease-drawer)", className)}
      style={{ height: height ?? undefined }}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}
