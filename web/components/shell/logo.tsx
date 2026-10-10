import { cn } from "@/lib/utils";

/** Three stacked records with the newest one highlighted: memory that grows. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden className={cn("size-7", className)}>
      <rect width="28" height="28" rx="8" className="fill-accent" />
      <rect x="7" y="7.5" width="14" height="3" rx="1.5" className="fill-accent-fg" opacity="0.45" />
      <rect x="7" y="12.5" width="14" height="3" rx="1.5" className="fill-accent-fg" opacity="0.7" />
      <rect x="7" y="17.5" width="9" height="3" rx="1.5" className="fill-accent-fg" />
      <circle cx="20" cy="19" r="2" className="fill-accent-fg" />
    </svg>
  );
}
