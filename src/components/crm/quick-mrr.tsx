"use client";
// Preenchimento de MRR em 1 clique para oportunidades sem valor (proposta/negociação).
// Sem MRR o pipeline aberto e o forecast ficam zerados, então o card pede o valor ali mesmo.
import { useState } from "react";
import { Button, cn } from "@/components/ui/primitives";
import { MRR_SUGGESTIONS } from "@/lib/domain/constants";
import type { Opportunity } from "@/lib/domain/types";
import { useActions } from "@/lib/data/hooks";

export const needsMrr = (o: Pick<Opportunity, "stage" | "mrr_value">) =>
  (o.stage === "proposta_enviada" || o.stage === "negociacao") && !(Number(o.mrr_value) > 0);

export function QuickMrr({ opp, className }: { opp: Opportunity; className?: string }) {
  const actions = useActions();
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (v: number) => {
    if (!(v > 0) || busy) return;
    setBusy(true);
    await actions.updateOpportunity(opp.id, { mrr_value: v }, `MRR de R$ ${v.toLocaleString("pt-BR")}/mês salvo.`);
    setBusy(false);
  };
  return (
    // o card em volta abre a ficha e é arrastável: os cliques aqui não podem vazar
    <div
      className={cn("rounded-lg border border-amber-500/30 bg-amber-500/5 p-1.5", className)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div className="mb-1 text-[10px] font-semibold text-amber-300">Sem MRR: o forecast não conta esta proposta</div>
      <div className="flex flex-wrap items-center gap-1">
        {MRR_SUGGESTIONS.map((v) => (
          <Button key={v} size="sm" disabled={busy} className="px-2 py-1 text-[11px]" onClick={() => save(v)} aria-label={`MRR R$ ${v}`}>
            R$ {v}
          </Button>
        ))}
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); save(Number(custom.replace(",", "."))); }}>
          <input aria-label="Outro valor de MRR" inputMode="decimal" placeholder="outro"
            className="w-16 rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
            value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button size="sm" type="submit" variant="primary" disabled={busy || !(Number(custom.replace(",", ".")) > 0)} className="px-2 py-1 text-[11px]">OK</Button>
        </form>
      </div>
    </div>
  );
}
