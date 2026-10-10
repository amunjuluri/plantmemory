import { cn } from "@/lib/utils";

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 font-sans text-[0.6875rem] font-medium",
        "bg-[oklch(1_0_0/0.16)] text-current",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
