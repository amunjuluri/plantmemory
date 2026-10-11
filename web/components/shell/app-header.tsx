"use client";

import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import {
  ChevronDown,
  ClipboardCheck,
  Database,
  FilePlus2,
  FlaskConical,
  Moon,
  Siren,
  Sun,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { api } from "@/lib/api";
import { ROLE_LABEL, useSession, type Role } from "@/lib/stores/session";
import { cn } from "@/lib/utils";
import { LogoMark } from "./logo";

const NAV = [
  { href: "/", label: "Breakdown", short: "Breakdown", icon: Wrench },
  { href: "/alarms/", label: "Alarm logs", short: "Alarms", icon: Siren },
  { href: "/guides/", label: "Guides", short: "Guides", icon: ClipboardCheck },
  { href: "/memory/", label: "Memory", short: "Memory", icon: Database },
  { href: "/add/", label: "Add records", short: "Add", icon: FilePlus2 },
] as const;

function useActive() {
  const pathname = usePathname();
  const path = pathname.endsWith("/") ? pathname : `${pathname}/`;
  return (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
}

/** Guides waiting for QA, refreshed on every navigation. */
function useReviewCount() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    api
      .guides("in_review")
      .then((guides) => live && setCount(guides.length))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [pathname]);
  return count;
}

function CountDot({ count, className }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span
      aria-label={`${count} waiting for QA`}
      className={cn(
        "tabular grid h-4.5 min-w-4.5 place-items-center rounded-full bg-warn px-1 text-[0.6875rem] font-semibold text-black/80",
        className,
      )}
    >
      {count}
    </span>
  );
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

/** Shown only while the demo data is loaded: the label belongs to the data, so a plant
 * running on its own manuals and records never sees it. */
function SyntheticBadge() {
  const [synthetic, setSynthetic] = useState(false);
  useEffect(() => {
    api.manuals().then((ms) => setSynthetic(ms.some((m) => /synthetic/i.test(m.manual_title))), () => undefined);
  }, []);
  if (!synthetic) return null;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger className="hidden h-7 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-xs font-medium text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] lg:inline-flex">
        <FlaskConical className="size-3.5" />
        Synthetic data
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={8}>
          <Tooltip.Popup className="max-w-64 origin-(--transform-origin) rounded-lg bg-fg px-3 py-2 text-xs leading-5 text-bg shadow-raised transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-instant:duration-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
            Every incident, manual, part and log here is invented for this demo. No real plant or
            company data is used.
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

const ROLES: { value: Role; label: string }[] = [
  { value: "manager", label: "Manager" },
  { value: "qa", label: "QA" },
];

/** Who is acting. No sign-in in this demo: pick a role and a name. */
function ActorSwitch() {
  const { role, names, setRole, setName } = useSession();
  const name = names[role] || ROLE_LABEL[role];
  return (
    <Popover.Root>
      <Popover.Trigger
        className="flex h-9 items-center gap-2 rounded-(--radius-control) pr-2 pl-1 text-sm transition-[background-color,scale] duration-150 ease-out hover:bg-surface-2 active:scale-[0.98] data-popup-open:bg-surface-2"
        aria-label={`Acting as ${name}, ${ROLE_LABEL[role]}. Change`}
      >
        <span
          className={cn(
            "grid size-7 place-items-center rounded-full text-[0.6875rem] font-semibold",
            role === "qa" ? "bg-success-soft text-success-text" : "bg-accent-soft text-accent-text",
          )}
        >
          {initials(name)}
        </span>
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="max-w-32 truncate text-[0.8125rem] font-medium">{name}</span>
          <span className="text-[0.6875rem] text-fg-subtle">{role === "qa" ? "QA" : "Manager"}</span>
        </span>
        <ChevronDown className="size-3.5 text-fg-subtle" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" className="z-50">
          <Popover.Popup className="w-72 origin-(--transform-origin) rounded-xl bg-surface p-4 shadow-raised transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
            <Popover.Title className="text-sm font-semibold">Acting as</Popover.Title>
            <Popover.Description className="mt-1 text-xs text-fg-muted">
              The demo has no sign-in. Switch to QA to review a guide; QA can’t approve a guide they
              sent themselves.
            </Popover.Description>
            <Segmented label="Role" options={ROLES} value={role} onChange={setRole} className="mt-3 w-full" />
            <label className="mt-3 flex flex-col gap-1.5 text-[0.8125rem] font-medium">
              Your name
              <Input
                value={names[role]}
                maxLength={80}
                onChange={(e) => setName(role, e.target.value)}
                placeholder={ROLE_LABEL[role]}
              />
            </label>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function AppHeader() {
  const isActive = useActive();
  const reviews = useReviewCount();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/80 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl backdrop-saturate-150 print:hidden">
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
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-fg-muted transition-[background-color,color] duration-150 ease-out hover:text-fg",
                "aria-[current=page]:bg-surface-2 aria-[current=page]:text-fg",
              )}
            >
              {label}
              {href === "/guides/" && <CountDot count={reviews} />}
            </Link>
          ))}
        </nav>
        <Tooltip.Provider delay={400}>
          <div className="ml-auto flex items-center gap-1.5">
            <SyntheticBadge />
            <ThemeToggle />
            <ActorSwitch />
          </div>
        </Tooltip.Provider>
      </div>
    </header>
  );
}

/** Phone navigation: a bottom tab bar, clear of the home indicator. */
export function MobileTabBar() {
  const isActive = useActive();
  const reviews = useReviewCount();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-xl backdrop-saturate-150 md:hidden print:hidden"
    >
      <div className="grid h-16 grid-cols-5">
        {NAV.map(({ href, short, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className="relative flex flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-fg-subtle transition-[color,scale] duration-150 ease-out active:scale-[0.96] aria-[current=page]:text-accent-text [&_svg]:size-5"
          >
            <Icon strokeWidth={1.75} />
            {short}
            {href === "/guides/" && <CountDot count={reviews} className="absolute top-2 left-[calc(50%+6px)]" />}
          </Link>
        ))}
      </div>
    </nav>
  );
}
