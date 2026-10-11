"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { sourceLabel } from "@/components/cited-text";
import { Button } from "@/components/ui/button";
import { ErrorState, Shimmer } from "@/components/ui/states";
import { api, figureUrl, type Guide, type GuideTranslation } from "@/lib/api";
import { useActorName } from "@/lib/stores/session";
import { cn, formatDateTime } from "@/lib/utils";

/** Fixed headings for the printed sheet, so they never depend on a model. */
const HEADINGS: Record<string, Record<string, string>> = {
  en: {
    safety: "Safety first",
    parts: "Parts to collect",
    steps: "Steps",
    done: "Done",
    restart: "Before restarting",
    escalate: "Stop and call the supervisor if",
    valid: "Valid for this breakdown only. Return this sheet to the supervisor when the work is done.",
  },
  te: {
    safety: "ముందుగా భద్రత",
    parts: "తీసుకోవలసిన విడిభాగాలు",
    steps: "దశలు",
    done: "అయింది",
    restart: "మళ్ళీ మొదలుపెట్టే ముందు",
    escalate: "ఇలా అయితే ఆపి సూపర్‌వైజర్‌ని పిలవండి",
    valid: "ఈ బ్రేక్‌డౌన్‌కు మాత్రమే. పని అయ్యాక ఈ కాగితాన్ని సూపర్‌వైజర్‌కు తిరిగి ఇవ్వండి.",
  },
  hi: {
    safety: "पहले सुरक्षा",
    parts: "लेने वाले पुर्ज़े",
    steps: "चरण",
    done: "हो गया",
    restart: "दोबारा चालू करने से पहले",
    escalate: "ऐसा हो तो रुकें और सुपरवाइज़र को बुलाएँ",
    valid: "सिर्फ़ इस ब्रेकडाउन के लिए। काम पूरा होने पर यह पन्ना सुपरवाइज़र को लौटाएँ।",
  },
};

function heading(key: string, langs: GuideTranslation[]) {
  return [HEADINGS.en[key], ...langs.map((t) => HEADINGS[t.language]?.[key]).filter(Boolean)];
}

function Heading({ parts, className }: { parts: string[]; className?: string }) {
  return (
    <h2 className={cn("flex flex-wrap items-baseline gap-x-2.5 text-[11pt] font-bold uppercase tracking-wide", className)}>
      {parts.map((p, i) => (
        <span key={i} className={cn(i > 0 && "indic font-semibold normal-case tracking-normal text-neutral-600")}>
          {i > 0 && <span className="mr-2.5 text-neutral-300">/</span>}
          {p}
        </span>
      ))}
    </h2>
  );
}

function Lines({ english, translated }: { english: string; translated: (string | undefined)[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10.5pt] leading-snug font-medium">{english}</p>
      {translated.map((t, i) =>
        t ? (
          <p key={i} className="indic text-[10.5pt] leading-snug text-neutral-800">
            {t}
          </p>
        ) : null,
      )}
    </div>
  );
}

const Box = () => <span aria-hidden className="inline-block size-[5mm] shrink-0 rounded-[1mm] border-[1.5px] border-black" />;

function Sheet({ guide, languages }: { guide: Guide; languages: GuideTranslation[] }) {
  const approved = guide.status === "approved" || guide.status === "closed";
  const made = guide.events.find((e) => e.action === "created");
  const approval = [...guide.events].reverse().find((e) => e.action === "approved");
  const printed = [...guide.events].reverse().find((e) => e.action === "printed");
  const sources = Array.from(new Set([...guide.steps, ...guide.safety, ...guide.restart_checks].flatMap((i) => i.citations)));

  return (
    <article className="relative mx-auto w-full max-w-[210mm] bg-white p-[10mm] text-black shadow-raised print:max-w-none print:p-0 print:shadow-none">
      {!approved && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden print:fixed"
        >
          <span className="-rotate-30 text-[48pt] font-black tracking-widest text-red-600/15 uppercase">
            Not approved
          </span>
        </div>
      )}

      <header className="border-b-2 border-black pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[8.5pt] font-semibold tracking-[0.15em] text-neutral-500 uppercase">Repair work instruction</p>
            <h1 className="mt-1 text-[16pt] leading-tight font-bold">{guide.title}</h1>
            {languages.map((t) => (
              <p key={t.language} className="indic mt-0.5 text-[11pt] font-semibold text-neutral-700">
                {t.title}
              </p>
            ))}
          </div>
          <div className="shrink-0 rounded-[1.5mm] border-2 border-black px-3 py-1.5 text-center">
            <p className="text-[8pt] font-bold tracking-wider uppercase">{approved ? "Controlled copy" : "Draft, do not use"}</p>
            <p className="tabular text-[13pt] font-bold">
              {approved && printed ? `Copy ${guide.copies_printed}` : "Copy –"}
            </p>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[8.5pt] sm:grid-cols-4 print:grid-cols-4">
          <div>
            <dt className="text-neutral-500">Guide</dt>
            <dd className="font-mono font-semibold">
              {guide.id} v{guide.version}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Machine</dt>
            <dd className="font-semibold">
              {guide.asset_tag ?? "Not identified"}
              {guide.error_codes.length > 0 && ` · ${guide.error_codes.join(", ")}`}
            </dd>
          </div>
          <div>
            <dt className="text-neutral-500">Prepared by</dt>
            <dd className="font-semibold">{made ? `${made.by}, ${formatDateTime(made.at)}` : "–"}</dd>
          </div>
          <div>
            <dt className="text-neutral-500">Approved by QA</dt>
            <dd className="font-semibold">{approval ? `${approval.by}, ${formatDateTime(approval.at)}` : "NOT APPROVED"}</dd>
          </div>
        </dl>
        <div className="mt-2 flex flex-col gap-0.5 text-[8.5pt] text-neutral-700">
          <p>
            {HEADINGS.en.valid}
            {printed && ` Printed by ${printed.by}, ${formatDateTime(printed.at)}.`}
          </p>
          {languages.map((t) => (
            <p key={t.language} className="indic">
              {HEADINGS[t.language]?.valid}
            </p>
          ))}
        </div>
      </header>

      {guide.safety.length > 0 && (
        <section className="mt-4 break-inside-avoid rounded-[1.5mm] border-2 border-black p-3">
          <Heading parts={heading("safety", languages)} />
          <ul className="mt-2 flex flex-col gap-2">
            {guide.safety.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-0.5 text-[11pt] leading-none">⚠</span>
                <Lines english={item.text} translated={languages.map((t) => t.safety[i])} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {guide.parts.length > 0 && (
        <section className="mt-4 break-inside-avoid">
          <Heading parts={heading("parts", languages)} />
          <table className="mt-2 w-full border-collapse text-[9.5pt]">
            <thead>
              <tr className="border-b border-black text-left text-[8pt] text-neutral-600 uppercase">
                <th className="py-1 pr-2 font-semibold">Part no.</th>
                <th className="py-1 pr-2 font-semibold">Part</th>
                <th className="py-1 pr-2 text-right font-semibold">Qty</th>
                <th className="py-1 font-semibold">Where</th>
              </tr>
            </thead>
            <tbody>
              {guide.parts.map((part) => (
                <tr key={part.part_no} className="border-b border-neutral-300">
                  <td className="py-1.5 pr-2 font-mono font-semibold whitespace-nowrap">{part.part_no}</td>
                  <td className="py-1.5 pr-2">{part.name}</td>
                  <td className="tabular py-1.5 pr-2 text-right font-semibold">{part.qty}</td>
                  <td className="py-1.5">{part.bin_location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="mt-4">
        <Heading parts={heading("steps", languages)} />
        <ol className="mt-2 border-t-2 border-black">
          {guide.steps.map((step, i) => (
            <li key={i} className="flex break-inside-avoid gap-3 border-b border-neutral-400 py-2.5">
              <span className="tabular grid size-[8mm] shrink-0 place-items-center rounded-full bg-black text-[11pt] font-bold text-white print:[print-color-adjust:exact]">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Lines english={step.text} translated={languages.map((t) => t.steps[i])} />
                {step.caution && (
                  <div className="flex gap-1.5 rounded-[1mm] border border-black px-2 py-1">
                    <span aria-hidden className="text-[10pt] leading-tight font-bold">!</span>
                    <Lines english={step.caution} translated={languages.map((t) => t.step_cautions[i] || undefined)} />
                  </div>
                )}
              </div>
              {step.figure_id && (
                // eslint-disable-next-line @next/next/no-img-element -- served by the API
                <img src={figureUrl(step.figure_id)} alt="" className="h-[32mm] w-[42mm] shrink-0 object-contain" />
              )}
              <div className="flex w-[12mm] shrink-0 flex-col items-center gap-1 pt-1">
                <Box />
                <span className="indic text-center text-[6.5pt] leading-tight text-neutral-500">
                  {heading("done", languages).join(" / ")}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {guide.restart_checks.length > 0 && (
        <section className="mt-4 break-inside-avoid">
          <Heading parts={heading("restart", languages)} />
          <ul className="mt-2 flex flex-col gap-2">
            {guide.restart_checks.map((item, i) => (
              <li key={i} className="flex gap-2.5">
                <Box />
                <Lines english={item.text} translated={languages.map((t) => t.restart_checks[i])} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {guide.escalate_if.length > 0 && (
        <section className="mt-4 break-inside-avoid rounded-[1.5mm] bg-neutral-100 p-3 print:[print-color-adjust:exact]">
          <Heading parts={heading("escalate", languages)} />
          <ul className="mt-2 flex flex-col gap-1.5">
            {guide.escalate_if.map((text, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-0.5 font-bold">✋</span>
                <Lines english={text} translated={languages.map((t) => t.escalate_if[i])} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5 grid break-inside-avoid grid-cols-3 gap-4 text-[8.5pt]">
        {["Work done by", "Finished at (time)", "Checked by supervisor"].map((label) => (
          <div key={label}>
            <div className="h-[9mm] border-b border-black" />
            <p className="mt-1 text-neutral-600">{label}</p>
          </div>
        ))}
      </section>

      <footer className="mt-4 border-t border-neutral-300 pt-2 text-[7.5pt] leading-snug text-neutral-500">
        Sources: {sources.map(sourceLabel).join(", ") || "none"}. Drafted by PlantMemory from plant records and
        equipment manuals; approved by QA before printing. Synthetic demo data.
      </footer>
    </article>
  );
}

export function PrintView() {
  const id = useSearchParams().get("id");
  const by = useActorName();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.guide(id).then(setGuide, (err: unknown) => setError(err instanceof Error ? err.message : "Couldn’t load the guide."));
  }, [id]);

  if (!id) return <ErrorState title="No guide chosen" message="Open a guide and choose Print." />;
  if (error) return <ErrorState title="Couldn’t load the guide" message={error} />;
  if (!guide) return <Shimmer className="mx-auto h-[60vh] w-full max-w-[210mm]" />;

  const approved = guide.status === "approved";
  const languages = guide.translations.filter((t) => !hidden.includes(t.language));

  const print = async () => {
    setPrinting(true);
    try {
      const printed = await api.printGuide(guide.id, by);
      // Render the new copy number before the print dialog snapshots the page.
      flushSync(() => setGuide(printed));
      window.print();
    } catch (err) {
      toast.error("Couldn’t record the printed copy", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="mx-auto flex w-full max-w-[210mm] flex-wrap items-center gap-3 print:hidden">
        <Link
          href={`/guides/view/?id=${encodeURIComponent(guide.id)}`}
          className="inline-flex items-center gap-1.5 rounded-lg text-sm text-fg-muted transition-[color] duration-150 ease-out hover:text-fg"
        >
          <ArrowLeft className="size-4" />
          Back to guide
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {guide.translations.map((t) => {
            const on = !hidden.includes(t.language);
            return (
              <button
                key={t.language}
                type="button"
                aria-pressed={on}
                onClick={() => setHidden((h) => (on ? [...h, t.language] : h.filter((x) => x !== t.language)))}
                className={cn(
                  "h-8 rounded-full px-3 text-[0.8125rem] font-medium transition-[background-color,color,scale] duration-150 ease-out active:scale-[0.97]",
                  on ? "bg-accent-soft text-accent-text" : "bg-surface-2 text-fg-subtle line-through",
                )}
              >
                {t.language_name}
              </button>
            );
          })}
          <Button variant="primary" onClick={print} loading={printing} disabled={!approved}>
            <Printer />
            {approved ? `Print copy ${guide.copies_printed + 1}` : "Needs QA approval"}
          </Button>
        </div>
      </div>
      {!approved && (
        <p className="mx-auto w-full max-w-[210mm] rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-text print:hidden">
          {guide.status === "closed"
            ? "This guide is closed. The preview is for reference only."
            : "Only QA-approved guides can be printed. This is a preview."}
        </p>
      )}
      <Sheet guide={guide} languages={languages} />
    </div>
  );
}
