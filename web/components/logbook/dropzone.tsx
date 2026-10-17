"use client";

import { Camera, ImageUp } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";
import { useLogbook } from "@/lib/stores/logbook";
import { cn } from "@/lib/utils";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";
const SAMPLES = [
  { file: "logbook_paper_01.png", label: "Paper mill shift log" },
  { file: "logbook_granulation_01.png", label: "Granulation area log (messy)" },
];

export function Dropzone() {
  const read = useLogbook((s) => s.read);
  const [dragging, setDragging] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
      toast.error("That isn’t a photo", { description: "Use a JPEG, PNG, WebP or HEIC image." });
      return;
    }
    void read(file);
  };

  const loadSample = async (name: string) => {
    try {
      const response = await fetch(`${API_BASE}/samples/${name}`);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      accept(new File([blob], name, { type: blob.type || "image/png" }));
    } catch {
      toast.error("Couldn’t load the sample page");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-4 rounded-(--radius-card) border border-dashed px-6 py-12 text-center",
          "transition-[background-color,border-color] duration-150 ease-out",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface",
        )}
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent-text">
          <ImageUp className="size-6" strokeWidth={1.75} />
        </span>
        <div>
          <p className="font-medium">Drop a photo of a logbook page</p>
          <p className="mt-1 text-sm text-fg-muted">
            Handwritten is fine. Each entry becomes a record you check before saving.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" className="[@media(pointer:fine)]:hidden" onClick={() => camera.current?.click()}>
            <Camera />
            Take photo
          </Button>
          <Button onClick={() => pick.current?.click()}>Choose photo</Button>
        </div>
        <p className="text-xs text-fg-subtle">JPEG, PNG, WebP or HEIC, up to 15 MB</p>
        <input ref={pick} type="file" accept={ACCEPT} className="hidden" onChange={(e) => accept(e.target.files?.[0])} />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-fg-subtle">No photo handy? Try a sample:</span>
        {SAMPLES.map((sample) => (
          <button
            key={sample.file}
            type="button"
            onClick={() => loadSample(sample.file)}
            className="h-8 rounded-full bg-surface-2 px-3 text-[0.8125rem] text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-3 hover:text-fg active:scale-[0.97]"
          >
            {sample.label}
          </button>
        ))}
      </div>
    </div>
  );
}
