import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--color-surface-2)_25%,var(--color-surface-3)_50%,var(--color-surface-2)_75%)] bg-[length:200%_100%]",
        className,
      )}
    />
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <Card className="flex flex-col items-start gap-3 p-5">
      <span className="grid size-8 place-items-center rounded-lg bg-danger-soft text-danger-text">
        <AlertCircle className="size-4" />
      </span>
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-fg-muted">{message}</p>
      </div>
      {onRetry && (
        <Button onClick={onRetry} size="sm">
          {retryLabel}
        </Button>
      )}
    </Card>
  );
}
