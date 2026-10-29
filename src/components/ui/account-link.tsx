"use client";
// Nome do restaurante clicável: abre a ficha 360º (gaveta) em qualquer tela.
import { cn } from "./primitives";
import { useUi } from "@/lib/ui-store";

export function AccountLink({ id, name, className }: { id: string; name: string; className?: string }) {
  const openDrawer = useUi((s) => s.openDrawer);
  return (
    <button
      type="button"
      title={`Abrir ficha de ${name}`}
      onClick={(e) => { e.stopPropagation(); openDrawer(id); }}
      className={cn(
        "block max-w-full truncate text-left underline decoration-slate-600 decoration-dotted underline-offset-2 hover:text-brand-300 hover:decoration-brand-400",
        className,
      )}
    >
      {name}
    </button>
  );
}
