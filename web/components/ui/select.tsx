"use client";

import { Select as BaseSelect } from "@base-ui/react/select";

import { cn } from "@/lib/utils";

export type SelectOption = { value: string | null; label: string; detail?: string };

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <path d="M4.5 6.25 8 9.75l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Tick({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden className={className}>
      <path d="m3.5 8.25 3 3 6-6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A dropdown styled like the rest of the app. The native <select> can't be styled, and its
 * menu doesn't open in some embedded browsers. `prefix` is a quiet label inside the trigger
 * ("Machine  Auto-detect").
 */
export function Select({
  value,
  onChange,
  options,
  label,
  prefix,
  disabled,
  align = "start",
  variant = "pill",
  className,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  options: SelectOption[];
  label: string;
  prefix?: string;
  disabled?: boolean;
  align?: "start" | "end";
  variant?: "pill" | "control";
  className?: string;
}) {
  return (
    <BaseSelect.Root
      items={options}
      value={value}
      onValueChange={(next) => onChange((next as string | null) ?? null)}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        aria-label={label}
        className={cn(
          "group inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-fg select-none",
          "transition-[background-color,box-shadow,scale] duration-150 ease-out active:not-data-disabled:scale-[0.97]",
          "focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-soft)]",
          "data-disabled:cursor-not-allowed data-disabled:opacity-50",
          variant === "pill"
            ? "h-8 rounded-full bg-surface-2 pr-2 pl-3 text-[0.8125rem] shadow-[inset_0_0_0_1px_var(--color-line)] hover:not-data-disabled:bg-surface-3 data-popup-open:bg-surface-3"
            : "h-9 rounded-(--radius-control) bg-surface pr-2 pl-3 text-sm shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:not-data-disabled:shadow-[inset_0_0_0_1px_var(--color-fg-subtle)]",
          className,
        )}
      >
        {prefix && <span className="text-fg-muted">{prefix}</span>}
        <BaseSelect.Value className="min-w-0 truncate font-medium" />
        <BaseSelect.Icon className="grid size-4 shrink-0 place-items-center text-fg-subtle transition-[rotate] duration-200 ease-out data-popup-open:rotate-180">
          <Chevron className="size-4" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          alignItemWithTrigger={false}
          side="bottom"
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 outline-none select-none"
        >
          <BaseSelect.Popup
            className={cn(
              "min-w-(--anchor-width) origin-(--transform-origin) rounded-xl bg-surface p-1 text-fg shadow-raised outline-none",
              "transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-[0.97] data-starting-style:opacity-0",
            )}
          >
            <BaseSelect.List className="max-h-[min(20rem,var(--available-height))] scroll-py-1 overflow-y-auto overscroll-contain">
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value ?? ""}
                  value={option.value}
                  className={cn(
                    "grid min-h-9 cursor-default grid-cols-[1fr_1rem] items-center gap-3 rounded-lg py-1.5 pr-2 pl-2.5 text-sm outline-none",
                    "data-highlighted:bg-surface-2 data-disabled:opacity-50",
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <BaseSelect.ItemText className="truncate font-medium">{option.label}</BaseSelect.ItemText>
                    {option.detail && <span className="truncate text-xs text-fg-subtle">{option.detail}</span>}
                  </span>
                  <BaseSelect.ItemIndicator className="text-accent-text">
                    <Tick className="size-4" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
