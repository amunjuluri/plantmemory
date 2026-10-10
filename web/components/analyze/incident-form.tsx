"use client";

import { ArrowRight, Camera, Square } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";
import { ModKey } from "@/components/ui/mod-key";
import { Segmented } from "@/components/ui/segmented";
import { api, type Industry } from "@/lib/api";
import { prepareImage } from "@/lib/image";
import { useAnalysis } from "@/lib/stores/analysis";
import { cn } from "@/lib/utils";

const EXAMPLES = [
  {
    label: "Sheet breaks at the press",
    text: "PM2 web broke 3 times this shift right after the 2nd press. Felt looks shiny and the uhle box vacuum is low.",
  },
  {
    label: "Colonies on a settle plate",
    text: "Grade B settle plate grew colonies again after the operator swapped a glove on isolator 3. Operator says she followed the SOP.",
  },
  {
    label: "Something new",
    text: "The forklift battery charger in the warehouse keeps tripping its breaker.",
  },
];

const INDUSTRIES: { value: "all" | Industry; label: string }[] = [
  { value: "all", label: "All" },
  { value: "paper", label: "Paper" },
  { value: "pharma", label: "Pharma" },
];

export function IncidentForm({ onStart }: { onStart?: () => void }) {
  const { text, industry, status, setText, setIndustry, run, cancel } = useAnalysis();
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const running = status === "running";
  const canSubmit = text.trim().length >= 5 && !running && !reading;

  const submit = () => {
    if (!canSubmit) return;
    onStart?.();
    void run();
  };

  const readPhoto = async (file: File) => {
    setReading(true);
    const id = toast.loading("Reading the photo…", {
      description: "This usually takes 10 to 40 seconds.",
    });
    try {
      const { blob, name } = await prepareImage(file);
      const result = await api.readLogbook(blob, name, industry);
      const [first, ...rest] = result.records;
      if (!first) {
        toast.error("No incident found on that photo", { id, description: result.page_notes ?? undefined });
        return;
      }
      setText(first.description);
      if (first.industry !== "generic") setIndustry(first.industry);
      toast.success("Filled in from the photo", {
        id,
        description: rest.length
          ? `The page has ${rest.length + 1} entries; the first is used. Use Digitize logbook to save them all.`
          : "Check the text, then find similar incidents.",
      });
    } catch (err) {
      toast.error("Couldn't read that photo", {
        id,
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <Card className="p-4 sm:p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="incident" className="text-sm font-medium">
            What’s happening?
          </label>
          <Textarea
            id="incident"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Describe it the way you would in the logbook. Short forms are fine."
            disabled={running}
            maxLength={8000}
            className="min-h-36"
            enterKeyHint="send"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Search in"
            size="sm"
            options={INDUSTRIES}
            value={industry ?? "all"}
            onChange={(value) => setIndustry(value === "all" ? null : value)}
          />
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
            Read from photo
          </Button>
        </div>

        {running ? (
          <Button type="button" size="lg" onClick={cancel}>
            <Square className="fill-current" />
            Stop
          </Button>
        ) : (
          <Button type="submit" variant="primary" size="lg" disabled={!canSubmit}>
            Find similar incidents
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
              onClick={() => setText(example.text)}
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
  );
}
