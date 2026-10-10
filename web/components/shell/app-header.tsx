"use client";

import { Tooltip } from "@base-ui/react/tooltip";
import { Database, FlaskConical, Moon, ScanText, Sparkles, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";

const NAV = [
  { href: "/", label: "Analyze", short: "Analyze", icon: Sparkles },
  { href: "/logbook/", label: "Digitize logbook", short: "Logbook", icon: ScanText },
  { href: "/memory/", label: "Memory", short: "Memory", icon: Database },
] as const;

function useActive() {
  const pathname = usePathname();
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Switch light or dark theme"
      className="grid size-9 place-items-center rounded-(--radius-control) text-fg-muted transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-2 hover:text-fg active:scale-[0.97] [&_svg]:size-4"
    >
      <Moon className="dark:hidden" />
      <Sun className="hidden dark:block" />
    </button>
  );
}

function SyntheticBadge() {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        className="hidden h-7 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-xs font-medium text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] sm:inline-flex"
      >
        <FlaskConical className="size-3.5" />
        Synthetic data
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={8}>
          <Tooltip.Popup className="max-w-64 origin-(--transform-origin) rounded-lg bg-fg px-3 py-2 text-xs leading-5 text-bg shadow-raised transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
            Every incident here is invented for this demo. No real plant or company data is used.
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function AppHeader() {
  const isActive = useActive();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-lg font-semibold tracking-tight">
          <LogoMark />
          <span className="text-[0.9375rem]">PlantMemory</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium text-fg-muted transition-[background-color,color] duration-150 ease-out hover:text-fg",
                "aria-[current=page]:bg-surface-2 aria-[current=page]:text-fg",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Tooltip.Provider delay={400}>
          <div className="ml-auto flex items-center gap-2">
            <SyntheticBadge />
            <ThemeToggle />
          </div>
        </Tooltip.Provider>
      </div>
    </header>
  );
}

/** Phone navigation: a bottom tab bar, clear of the home indicator. */
export function MobileTabBar() {
  const isActive = useActive();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl backdrop-saturate-150 md:hidden"
    >
      <div className="grid h-16 grid-cols-3">
        {NAV.map(({ href, short, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className="flex flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-fg-subtle transition-[color,scale] duration-150 ease-out active:scale-[0.96] aria-[current=page]:text-accent-text [&_svg]:size-5"
          >
            <Icon strokeWidth={1.75} />
            {short}
          </Link>
        ))}
      </div>
    </nav>
  );
}
