"use client";

import { Menu } from "@base-ui/react/menu";
import { ArrowLeft, Plus, Printer, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import { sourceLabel } from "@/components/cited-text";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ErrorState, Shimmer } from "@/components/ui/states";
import { api, figureUrl, type AppConfig, type Guide, type GuideTranslation } from "@/lib/api";
import { useActorName } from "@/lib/stores/session";
import { cn, formatDateTime } from "@/lib/utils";

/** Fixed headings for the printed sheet, so they never depend on a model. `native` is the
 * language's name in its own script, shown when choosing languages. */
const HEADINGS: Record<string, Record<string, string>> = {
  en: {
    native: "English",
    safety: "Safety first",
    parts: "Parts to collect",
    steps: "Steps",
    done: "Done",
    restart: "Before restarting",
    escalate: "Stop and call the supervisor if",
    valid: "Valid for this breakdown only. Return this sheet to the supervisor when the work is done.",
  },
  te: {
    native: "తెలుగు",
    safety: "ముందుగా భద్రత",
    parts: "తీసుకోవలసిన విడిభాగాలు",
    steps: "దశలు",
    done: "అయింది",
    restart: "మళ్ళీ మొదలుపెట్టే ముందు",
    escalate: "ఇలా అయితే ఆపి సూపర్‌వైజర్‌ని పిలవండి",
    valid: "ఈ బ్రేక్‌డౌన్‌కు మాత్రమే. పని అయ్యాక ఈ కాగితాన్ని సూపర్‌వైజర్‌కు తిరిగి ఇవ్వండి.",
  },
  hi: {
    native: "हिन्दी",
    safety: "पहले सुरक्षा",
    parts: "लेने वाले पुर्ज़े",
    steps: "चरण",
    done: "हो गया",
    restart: "दोबारा चालू करने से पहले",
    escalate: "ऐसा हो तो रुकें और सुपरवाइज़र को बुलाएँ",
    valid: "सिर्फ़ इस ब्रेकडाउन के लिए। काम पूरा होने पर यह पन्ना सुपरवाइज़र को लौटाएँ।",
  },
  ta: {
    native: "தமிழ்",
    safety: "முதலில் பாதுகாப்பு",
    parts: "எடுக்க வேண்டிய உதிரிபாகங்கள்",
    steps: "படிகள்",
    done: "முடிந்தது",
    restart: "மீண்டும் இயக்கும் முன்",
    escalate: "இப்படி நடந்தால் நிறுத்தி மேற்பார்வையாளரை அழைக்கவும்",
    valid: "இந்தப் பழுதுக்கு மட்டும். வேலை முடிந்ததும் இந்தத் தாளை மேற்பார்வையாளரிடம் திருப்பித் தரவும்.",
  },
  kn: {
    native: "ಕನ್ನಡ",
    safety: "ಮೊದಲು ಸುರಕ್ಷತೆ",
    parts: "ತೆಗೆದುಕೊಳ್ಳಬೇಕಾದ ಬಿಡಿಭಾಗಗಳು",
    steps: "ಹಂತಗಳು",
    done: "ಆಯಿತು",
    restart: "ಮತ್ತೆ ಪ್ರಾರಂಭಿಸುವ ಮೊದಲು",
    escalate: "ಹೀಗಾದರೆ ನಿಲ್ಲಿಸಿ ಮೇಲ್ವಿಚಾರಕರನ್ನು ಕರೆಯಿರಿ",
    valid: "ಈ ಬ್ರೇಕ್‌ಡೌನ್‌ಗೆ ಮಾತ್ರ. ಕೆಲಸ ಮುಗಿದ ನಂತರ ಈ ಹಾಳೆಯನ್ನು ಮೇಲ್ವಿಚಾರಕರಿಗೆ ಹಿಂತಿರುಗಿಸಿ.",
  },
  ml: {
    native: "മലയാളം",
    safety: "ആദ്യം സുരക്ഷ",
    parts: "എടുക്കേണ്ട സ്പെയർ പാർട്ടുകൾ",
    steps: "ഘട്ടങ്ങൾ",
    done: "കഴിഞ്ഞു",
    restart: "വീണ്ടും തുടങ്ങുന്നതിന് മുമ്പ്",
    escalate: "ഇങ്ങനെ സംഭവിച്ചാൽ നിർത്തി സൂപ്പർവൈസറെ വിളിക്കുക",
    valid: "ഈ ബ്രേക്ക്ഡൗണിന് മാത്രം. ജോലി കഴിഞ്ഞാൽ ഈ ഷീറ്റ് സൂപ്പർവൈസർക്ക് തിരികെ നൽകുക.",
  },
  mr: {
    native: "मराठी",
    safety: "आधी सुरक्षा",
    parts: "घ्यायचे सुटे भाग",
    steps: "पायऱ्या",
    done: "झाले",
    restart: "पुन्हा सुरू करण्यापूर्वी",
    escalate: "असे झाल्यास थांबा आणि सुपरवायझरला बोलवा",
    valid: "फक्त या बिघाडासाठी. काम झाल्यावर हा कागद सुपरवायझरला परत द्या.",
  },
  bn: {
    native: "বাংলা",
    safety: "আগে নিরাপত্তা",
    parts: "যে যন্ত্রাংশ নিতে হবে",
    steps: "ধাপ",
    done: "হয়েছে",
    restart: "আবার চালু করার আগে",
    escalate: "এমন হলে থামুন এবং সুপারভাইজারকে ডাকুন",
    valid: "শুধু এই ব্রেকডাউনের জন্য। কাজ শেষ হলে এই কাগজটি সুপারভাইজারকে ফেরত দিন।",
  },
  as: {
    native: "অসমীয়া",
    safety: "প্ৰথমে সুৰক্ষা",
    parts: "ল'বলগীয়া যন্ত্ৰাংশ",
    steps: "পদক্ষেপ",
    done: "হ'ল",
    restart: "পুনৰ চলোৱাৰ আগতে",
    escalate: "এনে হ'লে ৰখক আৰু চুপাৰভাইজাৰক মাতক",
    valid: "কেৱল এই ব্ৰেকডাউনৰ বাবে। কাম শেষ হ'লে এই কাগজখন চুপাৰভাইজাৰক ঘূৰাই দিয়ক।",
  },
  gu: {
    native: "ગુજરાતી",
    safety: "પહેલાં સલામતી",
    parts: "લેવાના સ્પેર પાર્ટ્સ",
    steps: "પગલાં",
    done: "થઈ ગયું",
    restart: "ફરી ચાલુ કરતાં પહેલાં",
    escalate: "આવું થાય તો રોકાઈ જાઓ અને સુપરવાઇઝરને બોલાવો",
    valid: "ફક્ત આ બ્રેકડાઉન માટે. કામ પૂરું થાય પછી આ કાગળ સુપરવાઇઝરને પાછો આપો.",
  },
  pa: {
    native: "ਪੰਜਾਬੀ",
    safety: "ਪਹਿਲਾਂ ਸੁਰੱਖਿਆ",
    parts: "ਲੈਣ ਵਾਲੇ ਪੁਰਜ਼ੇ",
    steps: "ਕਦਮ",
    done: "ਹੋ ਗਿਆ",
    restart: "ਦੁਬਾਰਾ ਚਾਲੂ ਕਰਨ ਤੋਂ ਪਹਿਲਾਂ",
    escalate: "ਇਹ ਹੋਵੇ ਤਾਂ ਰੁਕੋ ਅਤੇ ਸੁਪਰਵਾਈਜ਼ਰ ਨੂੰ ਬੁਲਾਓ",
    valid: "ਸਿਰਫ਼ ਇਸ ਬ੍ਰੇਕਡਾਊਨ ਲਈ। ਕੰਮ ਪੂਰਾ ਹੋਣ 'ਤੇ ਇਹ ਕਾਗਜ਼ ਸੁਪਰਵਾਈਜ਼ਰ ਨੂੰ ਵਾਪਸ ਕਰੋ।",
  },
  or: {
    native: "ଓଡ଼ିଆ",
    safety: "ପ୍ରଥମେ ସୁରକ୍ଷା",
    parts: "ନେବାକୁ ଥିବା ପାର୍ଟସ",
    steps: "ପଦକ୍ଷେପ",
    done: "ହୋଇଗଲା",
    restart: "ପୁଣି ଚାଲୁ କରିବା ପୂର୍ବରୁ",
    escalate: "ଏପରି ହେଲେ ବନ୍ଦ କରି ସୁପରଭାଇଜରଙ୍କୁ ଡାକନ୍ତୁ",
    valid: "କେବଳ ଏହି ବ୍ରେକଡାଉନ ପାଇଁ। କାମ ସରିବା ପରେ ଏହି କାଗଜ ସୁପରଭାଇଜରଙ୍କୁ ଫେରାଇ ଦିଅନ୍ତୁ।",
  },
  ur: {
    native: "اردو",
    safety: "پہلے حفاظت",
    parts: "لینے والے پرزے",
    steps: "مراحل",
    done: "ہو گیا",
    restart: "دوبارہ چالو کرنے سے پہلے",
    escalate: "ایسا ہو تو رک جائیں اور سپروائزر کو بلائیں",
    valid: "صرف اس خرابی کے لیے۔ کام مکمل ہونے پر یہ کاغذ سپروائزر کو واپس کریں۔",
  },
};

/** Urdu is written right to left; every other print language left to right. */
const dir = (language: string) => (language === "ur" ? "rtl" : undefined);

type Said = { text?: string; language: string };

function heading(key: string, langs: GuideTranslation[]): Said[] {
  return [
    { text: HEADINGS.en[key], language: "en" },
    ...langs.map((t) => ({ text: HEADINGS[t.language]?.[key], language: t.language })),
  ].filter((h) => h.text);
}

function Heading({ parts, className }: { parts: Said[]; className?: string }) {
  return (
    <h2 className={cn("flex flex-wrap items-baseline gap-x-2.5 text-[11pt] font-bold uppercase tracking-wide", className)}>
      {parts.map((p, i) => (
        <span key={i} className={cn(i > 0 && "indic font-semibold normal-case tracking-normal text-neutral-600")}>
          {i > 0 && <span className="mr-2.5 text-neutral-300">/</span>}
          <span lang={p.language} dir={dir(p.language)} className="text-[calc(11pt*var(--script,1))]">
            {p.text}
          </span>
        </span>
      ))}
    </h2>
  );
}

function Lines({ english, translated }: { english: string; translated: Said[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10.5pt] leading-snug font-medium">{english}</p>
      {translated.map((t) =>
        t.text ? (
          <p
            key={t.language}
            lang={t.language}
            dir={dir(t.language)}
            className="indic text-[calc(10.5pt*var(--script,1))] leading-snug text-neutral-800"
          >
            {t.text}
          </p>
        ) : null,
      )}
    </div>
  );
}

const Box = () => <span aria-hidden className="inline-block size-[5mm] shrink-0 rounded-[1mm] border-[1.5px] border-black" />;

function Sheet({ guide, languages }: { guide: Guide; languages: GuideTranslation[] }) {
  const approved = ["approved", "closed", "released"].includes(guide.status);
  const made = guide.events.find((e) => e.action === "created");
  const approval = [...guide.events].reverse().find((e) => e.action === "approved");
  const printed = [...guide.events].reverse().find((e) => e.action === "printed");
  // QA approved it if it was ever sent to QA; otherwise the manager did.
  const byQa = approval && guide.events.some((e) => e.action === "submitted" && e.at <= approval.at);
  const synthetic = guide.manual_sections.some((m) => m.manual_title.toLowerCase().includes("synthetic"));
  const sources = Array.from(new Set([...guide.steps, ...guide.safety, ...guide.restart_checks].flatMap((i) => i.citations)));

  return (
    <article className="relative w-[210mm] bg-white p-[10mm] text-black shadow-raised print:w-auto print:p-0 print:shadow-none">
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
              <p
                key={t.language}
                lang={t.language}
                dir={dir(t.language)}
                className="indic mt-0.5 text-[calc(11pt*var(--script,1))] font-semibold text-neutral-700"
              >
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
        <dl className="mt-3 grid grid-cols-4 gap-x-6 gap-y-1 text-[8.5pt]">
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
            <dt className="text-neutral-500">Approved by{approval ? (byQa ? " (QA)" : " (manager)") : ""}</dt>
            <dd className="font-semibold">{approval ? `${approval.by}, ${formatDateTime(approval.at)}` : "NOT APPROVED"}</dd>
          </div>
        </dl>
        <div className="mt-2 flex flex-col gap-0.5 text-[8.5pt] text-neutral-700">
          <p>
            {HEADINGS.en.valid}
            {printed && ` Printed by ${printed.by}, ${formatDateTime(printed.at)}.`}
          </p>
          {languages.map((t) => (
            <p
              key={t.language}
              lang={t.language}
              dir={dir(t.language)}
              className="indic text-[calc(8.5pt*var(--script,1))]"
            >
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
                <Lines english={item.text} translated={languages.map((t) => ({ text: t.safety[i], language: t.language }))} />
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
                <Lines english={step.text} translated={languages.map((t) => ({ text: t.steps[i], language: t.language }))} />
                {step.caution && (
                  <div className="flex gap-1.5 rounded-[1mm] border border-black px-2 py-1">
                    <span aria-hidden className="text-[10pt] leading-tight font-bold">!</span>
                    <Lines english={step.caution} translated={languages.map((t) => ({ text: t.step_cautions[i] || undefined, language: t.language }))} />
                  </div>
                )}
              </div>
              {step.figure_id && (
                // eslint-disable-next-line @next/next/no-img-element -- served by the API
                <img src={figureUrl(step.figure_id)} alt="" className="h-[32mm] w-[42mm] shrink-0 object-contain" />
              )}
              <div className="flex w-[12mm] shrink-0 flex-col items-center gap-0.5 pt-1">
                <Box />
                {heading("done", languages).map((h) => (
                  <span
                    key={h.language}
                    lang={h.language}
                    dir={dir(h.language)}
                    className="indic text-center text-[calc(6.5pt*var(--script,1))] leading-tight text-neutral-500"
                  >
                    {h.text}
                  </span>
                ))}
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
                <Lines english={item.text} translated={languages.map((t) => ({ text: t.restart_checks[i], language: t.language }))} />
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
                <Lines english={text} translated={languages.map((t) => ({ text: t.escalate_if[i], language: t.language }))} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5 grid break-inside-avoid grid-cols-4 gap-4 text-[8.5pt]">
        {["Work done by", "Finished at (time)", "Checked by supervisor", "Line clearance by QA"].map((label) => (
          <div key={label}>
            <div className="h-[9mm] border-b border-black" />
            <p className="mt-1 text-neutral-600">{label}</p>
          </div>
        ))}
      </section>

      <footer className="mt-4 border-t border-neutral-300 pt-2 text-[7.5pt] leading-snug text-neutral-500">
        Sources: {sources.map(sourceLabel).join(", ") || "none"}. Drafted by PlantMemory from plant records and
        equipment manuals; checked and approved by a person before printing.{synthetic && " Synthetic demo data."}
      </footer>
    </article>
  );
}

/**
 * Shows the sheet exactly as it prints: an A4 page, laid out at A4 width on every screen
 * and scaled down to fit a narrow one, like a PDF viewer. Pinch to zoom in.
 */
function FitToWidth({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const a4 = (210 / 25.4) * 96; // 210 mm in CSS pixels
    const fit = () => setScale(Math.min(1, el.clientWidth / a4));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="flex w-full justify-center print:block">
      <div style={{ "--fit": scale } as React.CSSProperties} className="[zoom:var(--fit)] print:[zoom:1]">
        {children}
      </div>
    </div>
  );
}

/**
 * Opens the print dialog for a copy already recorded. Phones open it only from a tap, and
 * by the time the copy is recorded the tap has expired: iOS ignores the call silently. If
 * no dialog opened, a toast offers the same copy behind a fresh tap (and says how to get a
 * PDF), instead of the button quietly moving on to the next copy number.
 */
function openPrint(copy: number) {
  let opened = false;
  const mark = () => {
    opened = true;
  };
  window.addEventListener("beforeprint", mark, { once: true });
  window.print();
  window.setTimeout(() => {
    window.removeEventListener("beforeprint", mark);
    if (opened) return;
    toast(`Copy ${copy} is recorded and ready`, {
      id: "print",
      duration: Infinity,
      description: "Tap Print to open the print sheet, then pick a printer or Save as PDF.",
      action: { label: "Print", onClick: () => window.print() },
    });
  }, 1000);
}

type LanguageOption = AppConfig["print_languages"][number];

/** A language added after approval was not seen by QA: it prints only if code found nothing
 * to check (the server refuses it otherwise). */
const blocked = (t: GuideTranslation) => Boolean(t.added_by && t.flags.length);

const CHIP =
  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-medium transition-[background-color,color,scale] duration-150 ease-out active:not-disabled:scale-[0.97] disabled:cursor-not-allowed";

/** Pick one more language for the sheet. Each is translated and checked when picked. */
function AddLanguage({
  options,
  onPick,
  disabled,
}: {
  options: LanguageOption[];
  onPick: (option: LanguageOption) => void;
  disabled: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled}
        className={cn(
          CHIP,
          "bg-surface-2 text-fg-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:not-disabled:bg-surface-3 hover:not-disabled:text-fg disabled:opacity-50 data-popup-open:bg-surface-3",
        )}
      >
        <Plus className="size-3.5" />
        Language
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-50 outline-none">
          <Menu.Popup
            className={cn(
              "w-64 origin-(--transform-origin) rounded-xl bg-surface p-1 text-fg shadow-raised outline-none",
              "transition-[opacity,scale] duration-150 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-[0.97] data-starting-style:opacity-0",
            )}
          >
            <p className="px-2.5 pt-1.5 pb-1 text-xs text-fg-subtle">
              Translated and checked in about 15 seconds. Each language adds a line under every step.
            </p>
            <div className="max-h-[min(20rem,var(--available-height))] overflow-y-auto overscroll-contain">
              {options.map((o) => (
                <Menu.Item
                  key={o.code}
                  onClick={() => onPick(o)}
                  className="flex min-h-9 cursor-default items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-sm outline-none data-highlighted:bg-surface-2"
                >
                  <span className="font-medium">{o.name}</span>
                  <span lang={o.code} dir={dir(o.code)} className="indic text-fg-subtle">
                    {HEADINGS[o.code]?.native}
                  </span>
                </Menu.Item>
              ))}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function PrintView() {
  const id = useSearchParams().get("id");
  const by = useActorName();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);
  const [options, setOptions] = useState<LanguageOption[]>([]);
  const [adding, setAdding] = useState<LanguageOption | null>(null);

  useEffect(() => {
    if (!id) return;
    api.guide(id).then(setGuide, (err: unknown) => setError(err instanceof Error ? err.message : "Couldn’t load the guide."));
  }, [id]);

  const approved = guide?.status === "approved";
  useEffect(() => {
    if (approved) api.config().then((c) => setOptions(c.print_languages), () => undefined);
  }, [approved]);

  if (!id) return <ErrorState title="No guide chosen" message="Open a guide and choose Print." />;
  if (error) return <ErrorState title="Couldn’t load the guide" message={error} />;
  if (!guide) return <Shimmer className="mx-auto h-[60vh] w-full max-w-[210mm]" />;

  const languages = guide.translations.filter((t) => !hidden.includes(t.language) && !blocked(t));
  const stuck = guide.translations.filter(blocked);
  const more = options.filter((o) => !guide.translations.some((t) => t.language === o.code));

  const add = async (option: LanguageOption) => {
    setAdding(option);
    try {
      const updated = await api.addGuideLanguage(guide.id, by, option.code);
      setGuide(updated);
      setHidden((h) => h.filter((x) => x !== option.code));
      const added = updated.translations.find((t) => t.language === option.code);
      if (added && blocked(added)) {
        toast.warning(`${option.name} can’t be printed yet`, { description: added.flags[0] });
      } else {
        toast.success(`${option.name} added to the sheet`, { description: "Checked: every number and code came through." });
      }
    } catch (err) {
      toast.error(`Couldn’t translate into ${option.name}`, { description: err instanceof Error ? err.message : undefined });
    } finally {
      setAdding(null);
    }
  };

  const print = async () => {
    setPrinting(true);
    try {
      const printed = await api.printGuide(guide.id, by, languages.map((t) => t.language));
      // Render the new copy number before the print dialog snapshots the page.
      flushSync(() => setGuide(printed));
      openPrint(printed.copies_printed);
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
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 max-sm:w-full max-sm:justify-start">
          <div role="group" aria-label="Languages on the sheet" className="flex flex-wrap items-center gap-2">
            {guide.translations.map((t) =>
              blocked(t) ? (
                <span key={t.language} className={cn(CHIP, "bg-warn-soft text-warn-text")}>
                  <TriangleAlert className="size-3.5" />
                  {t.language_name}
                </span>
              ) : (
                <button
                  key={t.language}
                  type="button"
                  aria-pressed={!hidden.includes(t.language)}
                  onClick={() =>
                    setHidden((h) => (h.includes(t.language) ? h.filter((x) => x !== t.language) : [...h, t.language]))
                  }
                  className={cn(
                    CHIP,
                    hidden.includes(t.language)
                      ? "bg-surface-2 text-fg-subtle line-through"
                      : "bg-accent-soft text-accent-text",
                  )}
                >
                  {t.language_name}
                </button>
              ),
            )}
            {adding && (
              <span role="status" className={cn(CHIP, "bg-surface-2 text-fg-muted")}>
                <Spinner className="size-3.5" />
                {adding.name}
                <span className="sr-only">: translating and checking</span>
              </span>
            )}
            {approved && more.length > 0 && (
              <AddLanguage options={more} onPick={(o) => void add(o)} disabled={Boolean(adding)} />
            )}
          </div>
          <Button
            variant="primary"
            onClick={print}
            loading={printing}
            disabled={!approved || Boolean(adding)}
            className="max-sm:mt-1 max-sm:w-full"
          >
            <Printer />
            {approved ? `Print copy ${guide.copies_printed + 1}` : "Needs approval"}
          </Button>
          {approved && (
            <p className="hidden w-full text-center text-xs text-fg-subtle sm:text-right [@media(pointer:coarse)]:block">
              Opens your phone’s print sheet. Pick a printer, or Save as PDF.
            </p>
          )}
        </div>
      </div>
      {stuck.map((t) => (
        <div
          key={t.language}
          role="status"
          className="mx-auto flex w-full max-w-[210mm] flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-text print:hidden"
        >
          <p className="min-w-56 flex-1">
            <span className="font-medium">{t.language_name} isn’t on the sheet.</span>{" "}
            {t.flags.length === 1 ? "One line" : `${t.flags.length} lines`} lost a number or code in translation:{" "}
            {t.flags[0]}
          </p>
          {approved && (
            <Button
              size="sm"
              onClick={() => void add({ code: t.language, name: t.language_name })}
              disabled={Boolean(adding)}
            >
              Translate again
            </Button>
          )}
        </div>
      ))}
      {!approved && (
        <p className="mx-auto w-full max-w-[210mm] rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn-text print:hidden">
          {guide.status === "closed" || guide.status === "released"
            ? "This guide is closed. The preview is for reference only."
            : "Only approved guides can be printed. This is a preview."}
        </p>
      )}
      <FitToWidth>
        <Sheet guide={guide} languages={languages} />
      </FitToWidth>
    </div>
  );
}
