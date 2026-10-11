"use client";

import { ArrowRight, Camera, Mic, Siren, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { ModKey } from "@/components/ui/mod-key";
import { VoicePanel } from "@/components/voice-panel";
import { api, type Asset } from "@/lib/api";
import { prepareImage } from "@/lib/image";
import { useBreakdown } from "@/lib/stores/breakdown";
import { useActorName } from "@/lib/stores/session";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  { label: "TP-02 punch tight", text: "TP-02 stopped in the middle of the batch. Screen shows E-104 punch tight.", asset: "TP-02" },
  { label: "Autoclave door seal (Telugu)", text: "ఆటోక్లేవ్ AC-2 సైకిల్ మొదలవ్వట్లేదు, door seal fault అని చూపిస్తోంది", asset: "AC-2" },
  { label: "Shallow blister pockets", text: "BL-3 blister pockets coming out shallow, then the machine stopped with a forming temperature alarm.", asset: "BL-3" },
  { label: "Something new", text: "The coating pan spray gun keeps dripping and the pan has stopped.", asset: null },
];

const select =
  "h-8 rounded-full bg-surface-2 pr-7 pl-3 text-[0.8125rem] text-fg shadow-[inset_0_0_0_1px_var(--color-line)] transition-[background-color] duration-150 ease-out hover:bg-surface-3 focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent),0_0_0_3px_var(--color-accent-soft)]";

export function BreakdownForm({ onStart }: { onStart?: () => void }) {
  const { text, assetTag, status, setText, setAssetTag, run, cancel } = useBreakdown();
  const by = useActorName();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [voice, setVoice] = useState(false);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const running = status === "running";
  const canSubmit = text.trim().length >= 5 && !running && !reading;

  useEffect(() => {
    api.assets().then(setAssets, () => undefined);
  }, []);

  const submit = () => {
    if (!canSubmit) return;
    onStart?.();
    void run(by);
  };

  const matchAsset = (name?: string | null) => {
    if (!name) return null;
    const key = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return assets.find((a) => a.tag.replace(/[^A-Z0-9]/gi, "").toUpperCase() === key)?.tag ?? null;
  };

  const readPhoto = async (file: File) => {
    setReading(true);
    const id = toast.loading("Reading the logbook photo…", { description: "This usually takes 10 to 40 seconds." });
    try {
      const { blob, name } = await prepareImage(file);
      const result = await api.readLogbook(blob, name, "pharma");
      const [first, ...rest] = result.records;
      if (!first) {
        toast.error("No breakdown found on that photo", { id, description: result.page_notes ?? undefined });
        return;
      }
      setText(`${first.area_or_equipment}: ${first.description}`);
      toast.success("Filled in from the photo", {
        id,
        description: rest.length
          ? `The page has ${rest.length + 1} entries; the first is used. Use Add records to save them all.`
          : "Check the text, then draft the guide.",
      });
    } catch (err) {
      toast.error("Couldn’t read that photo", { id, description: err instanceof Error ? err.message : undefined });
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 sm:p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="breakdown" className="text-sm font-medium whitespace-nowrap">
                What has broken down?
              </label>
              <select
                aria-label="Machine"
                value={assetTag ?? ""}
                disabled={running}
                onChange={(e) => setAssetTag(e.target.value || null)}
                className={select}
              >
                <option value="">Machine: detect</option>
                {assets.map((a) => (
                  <option key={a.tag} value={a.tag}>
                    {a.tag}
                  </option>
                ))}
              </select>
            </div>
            <Textarea
              id="breakdown"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Machine, alarm on the screen, what the worker saw. Any language, short forms are fine."
              disabled={running}
              maxLength={8000}
              className="indic min-h-32"
              enterKeyHint="send"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant={voice ? "primary" : "secondary"}
              size="sm"
              disabled={running}
              onClick={() => setVoice((v) => !v)}
              aria-pressed={voice}
            >
              <Mic />
              Speak
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && readPhoto(e.target.files[0])}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={reading}
              disabled={running}
              onClick={() => fileInput.current?.click()}
            >
              <Camera />
              Logbook photo
            </Button>
            <Link
              href="/alarms/"
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-(--radius-control) px-2.5 text-[0.8125rem] font-medium text-fg-muted transition-[background-color,color] duration-150 ease-out hover:bg-surface-2 hover:text-fg [&_svg]:size-3.5"
            >
              <Siren />
              From an alarm log
            </Link>
          </div>

          {running ? (
            <Button type="button" size="lg" onClick={cancel}>
              <Square className="fill-current" />
              Stop
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="lg" disabled={!canSubmit}>
              Draft repair guide
              <ArrowRight />
              <span className="ml-1 hidden items-center gap-0.5 [@media(pointer:fine)]:inline-flex">
                <Kbd>
                  <ModKey />
                </Kbd>
                <Kbd>↵</Kbd>
              </span>
            </Button>
          )}
        </form>

        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-2 text-xs font-medium text-fg-subtle">Try an example</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                type="button"
                disabled={running}
                onClick={() => {
                  setText(example.text);
                  setAssetTag(example.asset);
                }}
                className={cn(
                  "h-8 rounded-full bg-surface-2 px-3 text-[0.8125rem] text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)]",
                  "transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-3 hover:text-fg active:scale-[0.97] disabled:opacity-50",
                )}
              >
                {example.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {voice && !running && (
        <VoicePanel
          mode="breakdown"
          doneLabel="Draft repair guide"
          onClose={() => setVoice(false)}
          onDone={(result) => {
            setText(result.summary);
            const tag = matchAsset(result.state.fields.equipment);
            if (tag) setAssetTag(tag);
            setVoice(false);
            onStart?.();
            // Let the store pick up the new text before drafting.
            setTimeout(() => void useBreakdown.getState().run(by), 0);
          }}
        />
      )}
    </div>
  );
}
