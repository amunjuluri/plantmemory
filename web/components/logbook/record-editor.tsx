"use client";

import { Trash2 } from "lucide-react";
import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import type { Incident, Outcome } from "@/lib/api";
import { useLogbook } from "@/lib/stores/logbook";
import { INDUSTRY_LABEL, plural } from "@/lib/utils";

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "resolved", label: "Resolved" },
  { value: "recurred", label: "Came back" },
  { value: "unknown", label: "Unknown" },
];

const CheckTag = () => (
  <Badge tone="warn" className="h-4.5 px-1.5 text-[0.6875rem]">
    Check
  </Badge>
);

export function RecordEditor({ record, index }: { record: Incident; index: number }) {
  const { update, remove } = useLogbook();
  const uid = useId();
  const flagged = (field: string) => record.confidence_flags.includes(field);
  const text = (field: keyof Incident) => ({
    id: `${uid}-${field}`,
    value: (record[field] as string | null) ?? "",
    flagged: flagged(field),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      update(record.id, { [field]: e.target.value || null }),
  });
  const label = (field: string, name: string) => ({
    label: name,
    htmlFor: `${uid}-${field}`,
    trailing: flagged(field) ? <CheckTag /> : undefined,
  });
  const flags = record.confidence_flags.length;

  return (
    <Card
      className="transition-[opacity,translate] duration-250 ease-out starting:translate-y-2 starting:opacity-0"
      style={{ transitionDelay: `${index * 60}ms` }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="font-medium">Entry {index + 1}</h3>
        <Badge>{INDUSTRY_LABEL[record.industry]}</Badge>
        {flags > 0 ? (
          <Badge tone="warn">{plural(flags, "field")} to check</Badge>
        ) : (
          <Badge tone="success">Looks clear</Badge>
        )}
        <Button variant="danger" size="sm" className="ml-auto" onClick={() => remove(record.id)}>
          <Trash2 />
          Remove
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        <Field {...label("date", "Date")}>
          <Input
            type="date"
            id={`${uid}-date`}
            value={record.date}
            flagged={flagged("date")}
            onChange={(e) => e.target.value && update(record.id, { date: e.target.value })}
          />
        </Field>
        <Field {...label("area_or_equipment", "Equipment or area")}>
          <Input {...text("area_or_equipment")} />
        </Field>
        <Field {...label("description", "What happened")} className="sm:col-span-2">
          <Textarea {...text("description")} />
        </Field>
        <Field {...label("suspected_cause", "Suspected cause")}>
          <Textarea {...text("suspected_cause")} className="min-h-10" placeholder="Not written" />
        </Field>
        <Field {...label("root_cause", "Root cause")}>
          <Textarea {...text("root_cause")} className="min-h-10" placeholder="Not confirmed" />
        </Field>
        <Field {...label("action_taken", "What was done")} className="sm:col-span-2">
          <Textarea {...text("action_taken")} className="min-h-10" placeholder="Not written" />
        </Field>
        <Field label="Outcome" trailing={flagged("outcome") ? <CheckTag /> : undefined}>
          <Segmented
            label="Outcome"
            options={OUTCOMES}
            value={record.outcome}
            onChange={(outcome) => update(record.id, { outcome })}
            className="w-full"
          />
        </Field>
        <Field {...label("downtime_minutes", "Downtime (minutes)")}>
          <Input
            id={`${uid}-downtime_minutes`}
            inputMode="numeric"
            pattern="[0-9]*"
            className="tabular"
            flagged={flagged("downtime_minutes")}
            value={record.downtime_minutes ?? ""}
            placeholder="Not written"
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
              update(record.id, { downtime_minutes: digits ? Number(digits) : null });
            }}
          />
        </Field>
      </div>
    </Card>
  );
}
