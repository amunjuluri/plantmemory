"use client";

import { Popover } from "@base-ui/react/popover";
import { Check, Languages } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Shimmer } from "@/components/ui/states";
import { api, type AppConfig } from "@/lib/api";
import { NATIVE_NAME, dir } from "@/lib/languages";
import { useActorName, useSession } from "@/lib/stores/session";
import { track } from "@/lib/telemetry";
import { cn, formatDate } from "@/lib/utils";

const listNames = (names: string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** The languages the crew reads, chosen once for the plant: every guide is translated
 * into them when it is approved. Capped, since each adds a line under every step. */
export function FloorLanguages() {
  const by = useActorName();
  const manager = useSession((s) => s.role === "manager");
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.config().then(
      (c) => {
        setConfig(c);
        setPicked(c.floor_languages.map((l) => l.code));
      },
      () => toast.error("Couldn’t load the floor languages"),
    );

  const max = config?.max_sheet_languages ?? 3;
  const saved = config?.floor_languages.map((l) => l.code) ?? [];
  const changed = picked.join() !== saved.join();
  const nameOf = (code: string) => config?.print_languages.find((l) => l.code === code)?.name ?? code;

  const toggle = (code: string) =>
    setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : p.length < max ? [...p, code] : p));

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.setFloorLanguages(by, picked);
      setConfig(next);
      track("floor_languages_set", { languages: picked.join(","), count: picked.length });
      toast.success("Floor languages saved", {
        description: `Guides approved from now on are printed in English, ${listNames(picked.map(nameOf))}.`,
      });
      setOpen(false);
    } catch (err) {
      toast.error("Couldn’t save the floor languages", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <Popover.Trigger
        aria-label="Floor languages"
        title="Floor languages"
        className="grid size-9 place-items-center rounded-(--radius-control) text-fg-muted transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-2 hover:text-fg active:scale-[0.97] data-popup-open:bg-surface-2 data-popup-open:text-fg [&_svg]:size-4"
      >
        <Languages />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="end" collisionPadding={12} className="z-50">
          <Popover.Popup className="w-[min(22rem,calc(100vw-1.5rem))] origin-(--transform-origin) rounded-xl bg-surface p-4 shadow-raised outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0">
            <div className="flex items-baseline justify-between gap-3">
              <Popover.Title className="text-sm font-semibold">Floor languages</Popover.Title>
              {config && (
                <span className="tabular text-xs text-fg-subtle" aria-live="polite">
                  {picked.length} of {max}
                </span>
              )}
            </div>
            <Popover.Description className="mt-1 text-xs text-pretty text-fg-muted">
              What your crew reads. Every guide is translated into these when it’s approved and printed under
              the English. Up to {max}, so the sheet stays easy to follow.
            </Popover.Description>

            {config ? (
              <div role="group" aria-label="Floor languages" className="mt-3 grid auto-rows-fr grid-cols-2 gap-1.5">
                {config.print_languages.map((l) => {
                  const on = picked.includes(l.code);
                  const full = !on && picked.length >= max;
                  return (
                    <button
                      key={l.code}
                      type="button"
                      aria-pressed={on}
                      disabled={!manager || full}
                      onClick={() => toggle(l.code)}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-[background-color,color,opacity,scale] duration-150 ease-out active:not-disabled:scale-[0.97] disabled:cursor-not-allowed",
                        on
                          ? "bg-accent-soft text-accent-text"
                          : "bg-surface-2 text-fg hover:not-disabled:bg-surface-3 disabled:opacity-45",
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="text-[0.8125rem] font-medium">{l.name}</span>
                        <span
                          lang={l.code}
                          dir={dir(l.code)}
                          className={cn("indic truncate text-xs", on ? "text-accent-text/75" : "text-fg-subtle")}
                        >
                          {NATIVE_NAME[l.code]}
                        </span>
                      </span>
                      <Check
                        aria-hidden
                        className={cn(
                          "size-3.5 shrink-0 transition-[opacity,scale] duration-150 ease-out",
                          on ? "scale-100 opacity-100" : "scale-50 opacity-0",
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            ) : (
              <Shimmer className="mt-3 h-[17.5rem] w-full rounded-lg" />
            )}

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="min-w-0 text-xs text-fg-subtle">
                {!manager
                  ? "Only a manager changes these."
                  : config?.floor_languages_set_by && config.floor_languages_set_at
                    ? `Set by ${config.floor_languages_set_by}, ${formatDate(config.floor_languages_set_at)}`
                    : picked.length === 0
                      ? "Pick at least one."
                      : "Guides already approved keep theirs."}
              </p>
              {manager && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={save}
                  loading={saving}
                  disabled={!config || !changed || picked.length === 0}
                >
                  Save
                </Button>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
