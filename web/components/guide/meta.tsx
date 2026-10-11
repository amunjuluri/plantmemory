import { CircleCheck, CircleDashed, Clock3, FileWarning, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { figureUrl, type GuideStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

export const STATUS_LABEL: Record<GuideStatus, string> = {
  draft: "Draft",
  in_review: "Waiting for QA",
  approved: "Approved",
  rejected: "Sent back",
  closed: "Closed",
};

export function StatusBadge({ status }: { status: GuideStatus }) {
  const icon = {
    draft: <CircleDashed />,
    in_review: <Clock3 />,
    approved: <CircleCheck />,
    rejected: <FileWarning />,
    closed: <Lock />,
  }[status];
  const tone = ({ draft: "neutral", in_review: "warn", approved: "success", rejected: "danger", closed: "accent" } as const)[
    status
  ];
  return (
    <Badge tone={tone}>
      {icon}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/** A manual figure or part photo, on white in both themes (line drawings are black on white). */
export function Figure({
  id,
  caption,
  className,
  onClick,
}: {
  id: string;
  caption?: string | null;
  className?: string;
  onClick?: () => void;
}) {
  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- served by the API, already sized
    <img src={figureUrl(id)} alt={caption ?? ""} loading="lazy" className="h-full w-full object-contain" />
  );
  return (
    <figure className={cn("flex flex-col gap-1.5", className)}>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="overflow-hidden rounded-lg bg-white p-1.5 shadow-[inset_0_0_0_1px_var(--color-line)] transition-[box-shadow,scale] duration-150 ease-out hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)] active:scale-[0.99]"
          aria-label={caption ? `Open figure: ${caption}` : "Open figure"}
        >
          {image}
        </button>
      ) : (
        <div className="overflow-hidden rounded-lg bg-white p-1.5 shadow-[inset_0_0_0_1px_var(--color-line)]">{image}</div>
      )}
      {caption && <figcaption className="text-xs leading-5 text-fg-subtle">{caption}</figcaption>}
    </figure>
  );
}
