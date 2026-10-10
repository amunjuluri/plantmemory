import { RotateCcw, SearchCheck, SearchX } from "lucide-react";

import { CitedText } from "@/components/cited-text";
import type { Recurrence } from "@/lib/api";
import { cn } from "@/lib/utils";

function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: "warn" | "neutral";
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "warn" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-(--radius-card) p-4 transition-[opacity,translate] duration-250 ease-out starting:translate-y-1 starting:opacity-0",
        tone === "warn"
          ? "bg-warn-soft text-warn-text shadow-[inset_0_0_0_1px_oklch(0.72_0.15_70/0.3)]"
          : "bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--color-line)]",
      )}
    >
      <span className="mt-0.5 shrink-0 [&_svg]:size-4.5">{icon}</span>
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <div className="mt-1 text-sm leading-6">{children}</div>
      </div>
    </div>
  );
}

const ORDINAL_SUFFIX: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };
const ordinalRules = new Intl.PluralRules("en", { type: "ordinal" });

function ordinal(n: number) {
  return `${n}${ORDINAL_SUFFIX[ordinalRules.select(n)]}`;
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (!hours) return `${mins} min`;
  return mins ? `${hours} h ${mins} min` : `${hours} h`;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="tabular text-xl font-semibold tracking-tight">{value}</span>
      <span className="text-xs opacity-80">{label}</span>
    </div>
  );
}

export function RecurrenceBanner({ note, recurrence }: { note: string; recurrence?: Recurrence | null }) {
  const failedFix = note.includes("did not hold");
  const repeat = recurrence?.is_repeat ? recurrence : null;
  return (
    <Banner
      tone="warn"
      icon={<RotateCcw />}
      title={failedFix ? "This keeps coming back" : "This has happened before"}
    >
      {repeat && (
        <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
          <Stat value={`${ordinal(repeat.occurrence)} time`} label={`in ${repeat.window_months} months`} />
          {repeat.downtime_minutes > 0 && (
            <Stat value={formatMinutes(repeat.downtime_minutes)} label="of downtime so far" />
          )}
        </div>
      )}
      <CitedText text={note} />
    </Banner>
  );
}

export function CauseFlags({ flags }: { flags: string[] }) {
  return (
    <Banner tone="warn" icon={<SearchCheck />} title="Dig deeper before closing">
      <ul className="flex flex-col gap-1.5">
        {flags.map((flag) => (
          <li key={flag}>
            <CitedText text={flag} />
          </li>
        ))}
      </ul>
    </Banner>
  );
}

export function NoMatchBanner() {
  return (
    <Banner tone="neutral" icon={<SearchX className="text-fg-muted" />} title="No similar past incident found">
      <p className="text-fg-muted">
        Nothing in plant memory is close enough to this report. The suggestions below are general good
        practice, not plant history.
      </p>
    </Banner>
  );
}
