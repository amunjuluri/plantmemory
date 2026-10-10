import { cn } from "@/lib/utils";

/** A fast spinner reads as a faster load than a slow one, at the same wait. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="presentation"
      className={cn(
        "inline-block size-4 animate-spin-fast rounded-full border-2 border-current border-r-transparent opacity-80",
        className,
      )}
    />
  );
}
