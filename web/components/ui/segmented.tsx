"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";

import { cn } from "@/lib/utils";

type Option<T extends string> = { value: T; label: string };

/** Single-choice segmented control. Selecting the active option keeps it selected. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  size = "md",
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(next) => next[0] && onChange(next[0] as T)}
      className={cn(
        "inline-flex rounded-(--radius-control) bg-surface-2 p-0.5 shadow-[inset_0_0_0_1px_var(--color-line)]",
        className,
      )}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className={cn(
            "flex-1 rounded-[calc(var(--radius-control)-2px)] px-3 font-medium whitespace-nowrap text-fg-muted",
            "transition-[background-color,color,box-shadow] duration-150 ease-out hover:text-fg",
            "data-pressed:bg-surface data-pressed:text-fg data-pressed:shadow-card",
            size === "sm" ? "h-7 text-xs" : "h-8 text-[0.8125rem]",
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
