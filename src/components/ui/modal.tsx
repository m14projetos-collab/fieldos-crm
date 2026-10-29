"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./primitives";

/** Modal central no desktop, "bottom sheet" no celular. */
export function Modal({
  open, onOpenChange, title, description, children, footer, className,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "anim-pop fixed z-50 inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
            className,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-base font-bold text-white">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-xs text-slate-400">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Fechar">
              <X size={18} />
            </Dialog.Close>
          </div>
          {children}
          {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
