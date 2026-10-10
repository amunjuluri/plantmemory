import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-(--radius-card) bg-surface shadow-card", className)} {...props} />;
}

export function SectionLabel({ className, ...props }: ComponentProps<"h3">) {
  return (
    <h3
      className={cn("text-xs font-semibold tracking-wide text-fg-subtle uppercase", className)}
      {...props}
    />
  );
}
