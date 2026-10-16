"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";

import { LogbookView } from "@/components/logbook/logbook-view";
import { Segmented } from "@/components/ui/segmented";
import { CmmsImport } from "./cmms-import";
import { ManualUpload } from "./manual-upload";

type Tab = "logbook" | "cmms" | "manual";

const TABS: { value: Tab; label: string }[] = [
  { value: "logbook", label: "Logbook photo" },
  { value: "cmms", label: "SAP / CMMS export" },
  { value: "manual", label: "Equipment manual" },
];

export function AddView() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.value === params.get("tab"))?.value ?? "logbook") as Tab;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4">
        <Link
          href="/memory/"
          className="inline-flex items-center gap-1.5 self-start rounded-lg text-sm text-fg-muted transition-[color] duration-150 ease-out hover:text-fg"
        >
          <ArrowLeft className="size-4" />
          Plant memory
        </Link>
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">Add to plant memory</h1>
          <p className="mt-1.5 text-[0.9375rem] text-fg-muted text-pretty">
            Bring in what the plant already has: handwritten breakdown logs, maintenance history from SAP or
            another CMMS, and equipment manuals. Nothing extracted is saved until you check it.
          </p>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-tour="add-tabs">
          <Segmented
            label="What to add"
            options={TABS}
            value={tab}
            onChange={(value) => router.replace(`/add/?tab=${value}`, { scroll: false })}
          />
        </div>
      </header>
      {tab === "logbook" && <LogbookView />}
      {tab === "cmms" && <CmmsImport />}
      {tab === "manual" && <ManualUpload />}
    </div>
  );
}
