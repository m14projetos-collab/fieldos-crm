"use client";
import { useEffect, useState } from "react";
import { Button, SectionTitle } from "@/components/ui/primitives";
import { brl } from "@/lib/domain/dates";
import { PAIN_DEFAULTS, computePain } from "@/lib/domain/pain";
import type { Account, PainInputs } from "@/lib/domain/types";
import { useActions } from "@/lib/data/hooks";
import { toast } from "sonner";

const FIELDS: { k: keyof PainInputs; label: string; suffix?: string }[] = [
  { k: "orders_month", label: "Pedidos/mês no app" },
  { k: "avg_ticket", label: "Ticket médio", suffix: "R$" },
  { k: "commission_pct", label: "Comissão do app", suffix: "%" },
  { k: "errors_month", label: "Erros de comanda/mês" },
  { k: "migration_share_pct", label: "Migráveis p/ canal próprio", suffix: "%" },
  { k: "system_price", label: "Mensalidade do sistema", suffix: "R$" },
];

/** Calculadora de Ancoragem (CHAVE): o cliente vê o número da dor antes do preço. */
export function PainCalculator({ acc, wide }: { acc?: Account; wide?: boolean }) {
  const actions = useActions();
  const [inp, setInp] = useState<PainInputs>({ ...PAIN_DEFAULTS, ...acc?.pain_inputs });
  useEffect(() => setInp({ ...PAIN_DEFAULTS, ...acc?.pain_inputs }), [acc?.id, acc?.pain_inputs]);
  const r = computePain(inp);

  const save = () =>
    acc && actions.updateAccount(acc.id, { pain_inputs: inp, estimated_monthly_pain_brl: r.inactionCost }, "Ancoragem salva no card do restaurante.");
  const pitch = `Hoje você deixa cerca de ${brl(r.inactionCost)} por mês na mesa entre comissão evitável e erro de comanda.${r.paybackDays != null ? ` O sistema se paga em ${r.paybackDays} dias.` : ""}`;

  return (
    <section>
      <SectionTitle>Calculadora de Ancoragem de Dor</SectionTitle>
      <div className={wide ? "grid grid-cols-2 gap-2 sm:grid-cols-3" : "grid grid-cols-2 gap-2"}>
        {FIELDS.map((f) => (
          <label key={f.k} className="space-y-0.5 text-[11px] text-slate-400">
            {f.label}{f.suffix ? ` (${f.suffix})` : ""}
            <input
              type="number" inputMode="decimal" min={0}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-white focus:border-brand-500 focus:outline-none"
              value={inp[f.k] ?? 0}
              onChange={(e) => setInp((p) => ({ ...p, [f.k]: Number(e.target.value) }))}
            />
          </label>
        ))}
      </div>
      <div className="mt-3 space-y-1 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
        <Row label="Comissão paga hoje" value={`${brl(r.commissionMonth)}/mês`} />
        <Row label="Parte evitável (canal próprio)" value={`${brl(r.commissionAvoidable)}/mês`} />
        <Row label="Custo dos erros de comanda" value={`${brl(r.errorsMonth)}/mês`} />
        <div className="flex justify-between border-t border-emerald-500/20 pt-1.5 text-sm font-bold text-emerald-300">
          <span>Custo mensal da inação</span><span className="font-mono">{brl(r.inactionCost)}</span>
        </div>
        <Row label="Payback do sistema" value={r.paybackDays != null ? `${r.paybackDays} dias` : "informe a mensalidade"} />
        <p className="pt-1 text-[10px] text-slate-500">Premissas: 1 erro de comanda = 1 ticket perdido; só a % migrável da comissão conta como evitável.</p>
      </div>
      {r.inactionCost > 0 ? (
        <p className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5 text-xs italic text-slate-300">“{pitch}”</p>
      ) : null}
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="outline" disabled={r.inactionCost <= 0}
          onClick={() => void navigator.clipboard?.writeText(pitch).then(() => toast.success("Frase copiada."), () => toast.error("Não foi possível copiar."))}>
          Copiar frase
        </Button>
        {acc ? <Button size="sm" variant="success" onClick={() => void save()} disabled={r.inactionCost <= 0}>Salvar no card</Button> : null}
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-slate-300"><span>{label}</span><span className="font-mono">{value}</span></div>
  );
}
