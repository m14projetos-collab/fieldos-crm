"use client";
// Pipeline dentro da ficha: status da conta, oportunidade aberta (etapa, MRR, plano, previsão) e histórico.
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useMover } from "@/components/crm/move-dialog";
import { QuickMrr, needsMrr } from "@/components/crm/quick-mrr";
import { Button, SectionTitle } from "@/components/ui/primitives";
import { useActions } from "@/lib/data/hooks";
import { ACCOUNT_STATUS_LABEL, MRR_SUGGESTIONS, STAGE_LABEL } from "@/lib/domain/constants";
import { brl, formatDateBR } from "@/lib/domain/dates";
import { lossLabel } from "@/lib/domain/pipeline";
import type { Account, AccountStatus, OppStage, Opportunity } from "@/lib/domain/types";

const field = "w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none";
const STAGES: OppStage[] = ["lead", "qualificado", "demo_agendada", "proposta_enviada", "negociacao", "fechado", "perdido"];
const num = (v: string) => Number(v.replace(/\./g, "").replace(",", "."));

export function PipelinePanel({ acc, opps }: { acc: Account; opps: Opportunity[] }) {
  const mover = useMover();
  const actions = useActions();
  const open = opps.find((o) => o.stage !== "fechado" && o.stage !== "perdido");
  const history = opps.filter((o) => o !== open).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const [mrr, setMrr] = useState("");
  const [plan, setPlan] = useState("");
  const [close, setClose] = useState("");
  useEffect(() => {
    setMrr(open?.mrr_value ? String(open.mrr_value) : "");
    setPlan(open?.plan_name ?? "");
    setClose(open?.expected_close_date ?? "");
  }, [open?.id, open?.mrr_value, open?.plan_name, open?.expected_close_date]);

  const dirty = open && (num(mrr || "0") !== open.mrr_value || (plan.trim() || null) !== open.plan_name || (close || null) !== open.expected_close_date);

  return (
    <section>
      <SectionTitle>Pipeline</SectionTitle>
      <label className="mb-2 block space-y-0.5 text-[11px] text-slate-400">
        Status da conta
        <select
          aria-label="Status da conta"
          className={field}
          value={acc.status}
          onChange={(e) => mover({ kind: "account", id: acc.id, target: e.target.value as AccountStatus })}
        >
          {Object.entries(ACCOUNT_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>

      {open ? (
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-200">{open.title}</span>
            <span className="text-slate-400">{open.probability}%</span>
          </div>
          <label className="block space-y-0.5 text-[11px] text-slate-400">
            Etapa
            <select
              aria-label="Etapa da oportunidade"
              className={field}
              value={open.stage}
              onChange={(e) => mover({ kind: "opp", id: open.id, target: e.target.value as OppStage })}
            >
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
          </label>
          {needsMrr(open) ? <QuickMrr opp={open} /> : null}
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-0.5 text-[11px] text-slate-400">MRR (R$)
              <input className={field} inputMode="decimal" value={mrr} onChange={(e) => setMrr(e.target.value)} placeholder="0" />
            </label>
            <label className="space-y-0.5 text-[11px] text-slate-400">Plano
              <input className={field} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="Ex.: Pro" />
            </label>
            <label className="space-y-0.5 text-[11px] text-slate-400">Previsão
              <input className={field} type="date" value={close} onChange={(e) => setClose(e.target.value)} />
            </label>
          </div>
          {dirty ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                void actions.updateOpportunity(
                  open.id,
                  { mrr_value: num(mrr || "0"), plan_name: plan.trim() || null, expected_close_date: close || null },
                  "Oportunidade atualizada.",
                )
              }
            >
              Salvar valores
            </Button>
          ) : null}
        </div>
      ) : acc.status !== "perdido" ? (
        <CreateOpp accountId={acc.id} />
      ) : (
        <p className="text-xs text-slate-400">Conta perdida. Para reabrir, mude o status (a recuperação em 90 dias já está na fila).</p>
      )}

      {history.length ? (
        <ul className="mt-2 space-y-1">
          {history.map((o) => (
            <li key={o.id} className="flex justify-between gap-2 rounded-lg bg-slate-900/60 px-3 py-1.5 text-[11px] text-slate-400">
              <span className="truncate">{o.title}</span>
              <span className="shrink-0">
                {STAGE_LABEL[o.stage]} · {brl(o.mrr_value)}
                {o.stage === "fechado" && o.closed_at ? ` · ${formatDateBR(o.closed_at)}` : ""}
                {o.stage === "perdido" && o.loss_category ? ` · ${lossLabel(o.loss_category)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CreateOpp({ accountId }: { accountId: string }) {
  const actions = useActions();
  const [openForm, setOpenForm] = useState(false);
  const [mrr, setMrr] = useState("");
  const [plan, setPlan] = useState("");
  const [stage, setStage] = useState<OppStage>("qualificado");
  if (!openForm)
    return (
      <Button size="sm" onClick={() => setOpenForm(true)}>
        <Plus size={13} /> Criar oportunidade
      </Button>
    );
  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-3">
      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-0.5 text-[11px] text-slate-400">Etapa
          <select className={field} value={stage} onChange={(e) => setStage(e.target.value as OppStage)}>
            {STAGES.filter((s) => s !== "fechado" && s !== "perdido").map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="space-y-0.5 text-[11px] text-slate-400">MRR (R$)
          <input className={field} inputMode="decimal" value={mrr} onChange={(e) => setMrr(e.target.value)} placeholder="opcional" />
          <span className="flex gap-1">
            {MRR_SUGGESTIONS.map((v) => (
              <button key={v} type="button" className="rounded bg-slate-800 px-1 text-[10px] text-slate-300 hover:bg-slate-700" onClick={() => setMrr(String(v))}>{v}</button>
            ))}
          </span>
        </label>
        <label className="space-y-0.5 text-[11px] text-slate-400">Plano
          <input className={field} value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="opcional" />
        </label>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpenForm(false)}>Cancelar</Button>
        <Button
          size="sm"
          variant="primary"
          onClick={async () => {
            const id = await actions.createOpportunity({ accountId, stage, mrr: mrr ? num(mrr) : 0, planName: plan || null });
            if (id) setOpenForm(false);
          }}
        >
          Criar
        </Button>
      </div>
    </div>
  );
}
