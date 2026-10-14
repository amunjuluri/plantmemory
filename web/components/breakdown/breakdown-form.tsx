"use client";

import { ArrowRight, Camera, Siren, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AutoHeight } from "@/components/ui/auto-height";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { ModKey } from "@/components/ui/mod-key";
import { ScanningLoader } from "@/components/ui/loaders";
import { Select } from "@/components/ui/select";
import { VoiceIcon } from "@/components/voice/icons";
import { LiveVoice } from "@/components/voice/live-voice";
import { api, type Asset } from "@/lib/api";
import { prepareImage } from "@/lib/image";
import { EXAMPLES, useBreakdown } from "@/lib/stores/breakdown";
import { useLiveVoice } from "@/lib/stores/live-voice";
import { useActorName } from "@/lib/stores/session";
import { cn } from "@/lib/utils";

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
    const id = toast.loading("Reading the logbook photo…", {
      description: "This usually takes 10 to 40 seconds.",
      icon: <ScanningLoader className="text-fg-muted" />,
    });
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

  const speak = () => {
    setVoice(true);
    // Started inside the tap, so the browser allows the microphone and the reply audio.
    void useLiveVoice.getState().start("breakdown");
  };

  const voicePanel = (
    <LiveVoice
      mode="breakdown"
      title="What has broken down?"
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
  );

  return (
    <Card>
      <AutoHeight>
        <div className="p-4 sm:p-5">
          {voice && !running ? (
            voicePanel
          ) : (
            <div className="transition-opacity duration-300 ease-out starting:opacity-0">
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
                    <Select
                      label="Machine"
                      prefix="Machine"
                      align="end"
                      value={assetTag}
                      disabled={running}
                      onChange={setAssetTag}
                      options={[
                        { value: null, label: "Auto-detect", detail: "From what you describe" },
                        ...assets.map((a) => ({ value: a.tag, label: a.tag, detail: a.equipment_model })),
                      ]}
                    />
                  </div>
                  <Textarea
                    id="breakdown"
                    data-tour="report"
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
                  <Button type="button" variant="secondary" size="sm" disabled={running} onClick={speak} data-tour="speak">
                    <VoiceIcon />
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
                  <Button type="submit" variant="primary" size="lg" disabled={!canSubmit} data-tour="draft">
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
                <div className="flex flex-wrap gap-1.5" data-tour="examples">
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
            </div>
          )}
        </div>
      </AutoHeight>
    </Card>
  );
}
