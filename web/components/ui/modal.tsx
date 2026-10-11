"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A centred dialog on desktop, a bottom sheet-style card on phones. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 min-h-dvh bg-black/30 transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 dark:bg-black/60" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-2 sm:items-center sm:p-6">
          <Dialog.Popup
            className={cn(
              "relative flex max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-y-auto overscroll-contain rounded-2xl bg-surface p-5 text-fg shadow-raised outline-none sm:p-6",
              "transition-[opacity,translate,scale] duration-200 ease-out data-ending-style:translate-y-2 data-ending-style:opacity-0 data-starting-style:translate-y-2 data-starting-style:opacity-0 sm:data-ending-style:translate-y-0 sm:data-ending-style:scale-[0.97] sm:data-starting-style:translate-y-0 sm:data-starting-style:scale-[0.97]",
              className,
            )}
          >
            <Dialog.Close
              aria-label="Close"
              className="absolute top-3 right-3 grid size-8 place-items-center rounded-lg text-fg-subtle transition-[background-color,color,scale] duration-150 ease-out hover:bg-surface-2 hover:text-fg active:scale-[0.97]"
            >
              <X className="size-4" />
            </Dialog.Close>
            <Dialog.Title className="pr-8 text-lg font-semibold tracking-tight">{title}</Dialog.Title>
            {description && <Dialog.Description className="mt-1 text-sm text-fg-muted">{description}</Dialog.Description>}
            <div className="mt-5">{children}</div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
