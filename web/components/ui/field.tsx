import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

const control = [
  "w-full rounded-(--radius-control) bg-surface px-3 text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
  "placeholder:text-fg-subtle transition-[box-shadow] duration-150 ease-out",
  "hover:shadow-[inset_0_0_0_1px_var(--color-fg-subtle)]",
  "focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-soft)]",
  "disabled:opacity-60",
];

/** Flagged fields get an amber ring: the AI was unsure and a person should check. */
const flaggedControl =
  "shadow-[inset_0_0_0_1px_var(--color-warn),0_0_0_3px_var(--color-warn-soft)] hover:shadow-[inset_0_0_0_1px_var(--color-warn),0_0_0_3px_var(--color-warn-soft)]";

export function Input({ className, flagged, ...props }: ComponentProps<"input"> & { flagged?: boolean }) {
  return <input className={cn(control, "h-10", flagged && flaggedControl, className)} {...props} />;
}

export function Textarea({
  className,
  flagged,
  ...props
}: ComponentProps<"textarea"> & { flagged?: boolean }) {
  return (
    <textarea
      className={cn(
        control,
        "min-h-20 max-w-full resize-none py-2.5 leading-6 [field-sizing:content]",
        flagged && flaggedControl,
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
  trailing,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-fg">
          {label}
        </label>
        {trailing}
      </div>
      {children}
      {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}
