"use client";
// Controles de 1 clique direto no card do restaurante (sem abrir ficha): etapa, sistema atual, temperatura,
// MRR e ações (WhatsApp com o script da etapa, check-in, ficha 360º). Tudo passa pelas mesmas regras do funil.
import { CalendarCheck, MessageCircle, PanelRightOpen } from "lucide-react";
import { useMover } from "./move-dialog";
import { Button, cn } from "@/components/ui/primitives";
import { useActions, useScriptCtx, useSnapshot } from "@/lib/data/hooks";
import { cadenceScript, followUpScript, waLink, waNumber } from "@/lib/domain/cadence";
import { ACCOUNT_STATUS_LABEL, MRR_SUGGESTIONS } from "@/lib/domain/constants";
import type { EnrichedAccount } from "@/lib/domain/enrich";
import type { AccountStatus, Interest, Opportunity, Visit } from "@/lib/domain/types";
import { useUi } from "@/lib/ui-store";

export const STAGE_PILLS: { status: AccountStatus; label: string }[] = [
  { status: "novo_lead", label: "Novo Lead" },
  { status: "discovery", label: "Discovery" },
  { status: "agendado", label: "Agendado" },
  { status: "demo_realizada", label: "Demo Realizada" },
  { status: "proposta_enviada", label: "Proposta Enviada" },
  { status: "negociacao", label: "Negociação" },
  { status: "fechado", label: "Fechado ✅" },
];

export const SYSTEM_OPTIONS = ["Saipos", "Yogga", "Anota AI", "iFood Gestor", "Planilha / Manual", "A validar"];

const TEMP: Record<Interest, { label: string; next: Interest; cls: string }> = {
  quente: { label: "🔥 Quente", next: "morno", cls: "border-red-500/40 bg-red-500/15 text-red-300" },
  morno: { label: "☀️ Morno", next: "frio", cls: "border-amber-500/40 bg-amber-500/15 text-amber-300" },
  frio: { label: "❄️ Frio", next: "quente", cls: "border-sky-500/40 bg-sky-500/15 text-sky-300" },
};

/** Status de prospecção ainda sem pílula própria: mostram como "Novo Lead". */
const pillOf = (s: AccountStatus): AccountStatus =>
  s === "lead_importado" || s === "a_validar" || s === "lead_frio" ? "novo_lead" : s === "primeiro_contato" ? "discovery" : s;

export function StagePills({ acc }: { acc: EnrichedAccount }) {
  const mover = useMover();
  const cur = pillOf(acc.status);
  return (
    <div role="group" aria-label={`Etapa de ${acc.name}`} className="flex flex-wrap gap-1">
      {STAGE_PILLS.map((p) => {
        const on = cur === p.status;
        return (
          <button key={p.status} type="button" aria-pressed={on}
            title={on && acc.status !== p.status ? `Agora: ${ACCOUNT_STATUS_LABEL[acc.status]}` : `Mover para ${p.label}`}
            onClick={(e) => { e.stopPropagation(); if (acc.status !== p.status) mover({ kind: "account", id: acc.id, target: p.status }); }}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
              on ? (p.status === "fechado" ? "border-emerald-500 bg-emerald-500 text-[#0b0f19]" : "border-brand-600 bg-brand-600 text-onaccent")
                : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200",
            )}>
            {p.label}
          </button>
        );
      })}
      {acc.status === "perdido" ? <span className="shrink-0 rounded-full border border-red-500/40 px-2.5 py-1 text-[11px] text-red-300">Perdido ❌</span> : null}
    </div>
  );
}

export function SystemSelect({ acc, className }: { acc: EnrichedAccount; className?: string }) {
  const actions = useActions();
  const cur = acc.current_system?.trim() || "A validar";
  const opts = SYSTEM_OPTIONS.includes(cur) ? SYSTEM_OPTIONS : [cur, ...SYSTEM_OPTIONS];
  return (
    <label className={cn("flex items-center gap-1 text-[11px] text-slate-400", className)} onClick={(e) => e.stopPropagation()}>
      ⚙️
      <select aria-label={`Sistema atual de ${acc.name}`} value={cur}
        onChange={(e) => void actions.updateAccount(acc.id, { current_system: e.target.value === "A validar" ? null : e.target.value }, `Sistema: ${e.target.value}.`)}
        className="max-w-36 rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200">
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

export function TempPill({ acc }: { acc: EnrichedAccount }) {
  const actions = useActions();
  const t = TEMP[acc.interest_level];
  return (
    <button type="button" title={`Trocar para ${TEMP[t.next].label}`} aria-label={`Temperatura ${t.label}. Tocar troca para ${TEMP[t.next].label}`}
      onClick={(e) => { e.stopPropagation(); void actions.updateAccount(acc.id, { interest_level: t.next }); }}
      className={cn("shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold", t.cls)}>
      {t.label}
    </button>
  );
}

export function MrrChips({ opp }: { opp: Opportunity }) {
  const actions = useActions();
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <span className="text-[10px] text-slate-500">MRR</span>
      {MRR_SUGGESTIONS.map((v) => {
        const on = Number(opp.mrr_value) === v;
        return (
          <button key={v} type="button" aria-pressed={on} aria-label={`MRR R$ ${v}`}
            onClick={() => !on && void actions.updateOpportunity(opp.id, { mrr_value: v }, `MRR R$ ${v}/mês. Forecast atualizado.`)}
            className={cn("rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-bold",
              on ? "border-emerald-500 bg-emerald-500/20 text-emerald-300" : "border-slate-700 text-slate-300 hover:border-slate-500")}>
            R${v}
          </button>
        );
      })}
      {Number(opp.mrr_value) > 0 && !MRR_SUGGESTIONS.includes(Number(opp.mrr_value) as (typeof MRR_SUGGESTIONS)[number]) ? (
        <span className="font-mono text-[11px] font-bold text-emerald-300">R${Number(opp.mrr_value)}</span>
      ) : null}
    </div>
  );
}

/** Bloco completo de 1 clique para um card de lead. */
export function LeadControls({
  acc, openOpp, visit, compact,
}: { acc: EnrichedAccount; openOpp?: Opportunity; visit?: Visit; compact?: boolean }) {
  const { openDrawer, openQuickLog } = useUi();
  const sctx = useScriptCtx();
  const actions = useActions();
  const { data } = useSnapshot();
  // check-in: usa a visita aberta da conta; sem visita, registra uma visita agora (visita não planejada) e abre o Quick Log
  const checkIn = async () => {
    const open = visit ?? data?.visits
      .filter((v) => v.account_id === acc.id && (v.status === "agendada" || v.status === "em_andamento") && new Date(v.scheduled_at).getTime() <= Date.now() + 12 * 3_600_000)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
    if (open) return openQuickLog(open.id);
    const id = await actions.scheduleVisit(
      { accountId: acc.id, scheduledAt: new Date().toISOString(), visitType: acc.status === "fechado" ? "pos_venda" : "primeiro_contato", durationMinutes: 30 },
      { silent: true },
    );
    if (id) openQuickLog(id);
  };
  const fu = acc.next_followup;
  const text = fu ? followUpScript(fu, acc, sctx, visit) : cadenceScript(acc.cadence_day, acc, sctx);
  const wa = waLink(waNumber(acc), text);
  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      {!compact ? <StagePills acc={acc} /> : null}
      <div className="flex flex-wrap items-center gap-1.5">
        <TempPill acc={acc} />
        <SystemSelect acc={acc} />
        {openOpp ? <MrrChips opp={openOpp} /> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer" title="WhatsApp com o script da etapa"
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25">
            <MessageCircle size={13} /> WA
          </a>
        ) : null}
        <Button size="sm" variant="warn" onClick={() => void checkIn()}><CalendarCheck size={13} /> Check-in</Button>
        <Button size="sm" onClick={() => openDrawer(acc.id)}><PanelRightOpen size={13} /> Ficha 360º</Button>
      </div>
    </div>
  );
}
