import { CircleCheck, CircleDashed, RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Outcome } from "@/lib/api";
import { OUTCOME_LABEL } from "@/lib/utils";

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  if (outcome === "resolved")
    return (
      <Badge tone="success">
        <CircleCheck />
        {OUTCOME_LABEL.resolved}
      </Badge>
    );
  if (outcome === "recurred")
    return (
      <Badge tone="danger">
        <RotateCcw />
        {OUTCOME_LABEL.recurred}
      </Badge>
    );
  return (
    <Badge>
      <CircleDashed />
      {OUTCOME_LABEL.unknown}
    </Badge>
  );
}

export function RecordId({ id }: { id: string }) {
  return <span className="font-mono text-xs font-medium tracking-tight text-fg-muted">{id}</span>;
}
