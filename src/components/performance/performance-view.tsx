"use client";
// Performance: metas que se calculam sozinhas, Daily automática + check-in, funil e conversões.
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, Card, SectionTitle, cn } from "@/components/ui/primitives";
import { useActions, useEnriched, useRepo, useSnapshot } from "@/lib/data/hooks";
import { PERSONA_LABEL } from "@/lib/domain/constants";
import { addDays, brl, dateInTz, formatDateBR } from "@/lib/domain/dates";
import {
  activitySeries, conversionBy, dayNumbers, funnel, goalStatus, lossReasons, periodPresets, salesCycleDays,
} from "@/lib/domain/performance";
import { lossLabel } from "@/lib/domain/pipeline";
import type { Goal, Mood } from "@/lib/domain/types";
import type { EnrichedAccount } from "@/lib/domain/enrich";

const CATEGORY_LABEL: Record<Goal["category"], string> = {
  visitas: "Visitas realizadas", demonstracoes: "Demonstrações", propostas: "Propostas enviadas",
  vendas: "Vendas fechadas", receita_mrr: "MRR fechado (R$)", novos_leads: "Novos leads",
};
const PERIOD_LABEL: Record<Goal["period_type"], string> = { diaria: "por dia", semanal: "por semana", mensal: "por mês" };
const MOODS: { id: Mood; label: string }[] = [
  { id: "otimo", label: "😀 Ótimo" }, { id: "bom", label: "🙂 Bom" }, { id: "normal", label: "😐 Normal" },
  { id: "cansativo", label: "😕 Cansativo" }, { id: "dificil", label: "😩 Difícil" },
];
const field = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none";
const fmtVal = (cat: Goal["category"], v: number) => (cat === "receita_mrr" ? brl(v) : String(Math.round(v * 10) / 10));

export function PerformanceView() {
  const { data, isLoading } = useSnapshot();
  const { session } = useRepo();
  const tz = session.timezone;
  const today = dateInTz(new Date(), tz);
  if (isLoading || !data) return <div className="py-20 text-center text-sm text-slate-500">Carregando performance…</div>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-white">Performance</h1>
        <p className="text-xs text-slate-400">Nada é digitado: metas, Daily e funil saem das visitas, follow-ups e pipeline.</p>
      </div>
      <Goals today={today} />
      <Daily today={today} />
      <FunnelBlock today={today} />
    </div>
  );
}

// ---------------------------------------------------------------------------
function Goals({ today }: { today: string }) {
  const { data } = useSnapshot();
  const { session } = useRepo();
  const actions = useActions();
  const [edit, setEdit] = useState<Goal | null>(null);
  const statuses = (data?.goals ?? []).map((g) => goalStatus(g, data!, session.timezone, today)).filter((s) => s.state !== "fora");
  const blank = (category: Goal["category"] = "visitas", period: Goal["period_type"] = "diaria"): Goal => ({
    id: crypto.randomUUID(), org_id: session.orgId, owner_id: session.userId, title: "", category, period_type: period,
    ...periodPresets(today)[period], target_value: 0,
  });

  return (
    <Card>
      <SectionTitle right={<Button size="sm" variant="primary" onClick={() => setEdit(blank())}><Plus size={13} /> Meta</Button>}>
        Metas (período atual)
      </SectionTitle>
      {edit ? <GoalForm goal={edit} today={today} onClose={() => setEdit(null)} /> : null}
      {!statuses.length && !edit ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Nenhuma meta ativa. Comece por uma destas (você define o número):</p>
          <div className="flex flex-wrap gap-1.5">
            {([["visitas", "diaria"], ["propostas", "semanal"], ["vendas", "mensal"], ["receita_mrr", "mensal"]] as const).map(([c, p]) => (
              <Button key={c} size="sm" onClick={() => setEdit(blank(c, p))}>{CATEGORY_LABEL[c]} {PERIOD_LABEL[p]}</Button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2">
        {statuses.map((st) => {
          const target = Number(st.goal.target_value);
          const color = st.state === "batida" ? "bg-emerald-400" : "bg-gradient-to-r from-rose-600 to-emerald-400";
          return (
            <div key={st.goal.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-100">{st.goal.title || CATEGORY_LABEL[st.goal.category]}</div>
                  <div className="text-[10px] text-slate-500">
                    {CATEGORY_LABEL[st.goal.category]} {PERIOD_LABEL[st.goal.period_type]}
                    {st.window && st.window.start !== st.window.end ? ` · ${formatDateBR(st.window.start)} a ${formatDateBR(st.window.end)}` : ""}
                    {st.goal.owner_id ? "" : " · time"}
                  </div>
                </div>
                <span className="flex gap-1">
                  <button type="button" aria-label="Editar meta" className="p-1 text-slate-500 hover:text-slate-200" onClick={() => setEdit(st.goal)}><Pencil size={12} /></button>
                  <button type="button" aria-label="Excluir meta" className="p-1 text-slate-500 hover:text-red-300"
                    onClick={() => window.confirm("Excluir esta meta?") && void actions.deleteGoal(st.goal.id)}><Trash2 size={12} /></button>
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-mono text-2xl font-extrabold text-white">{fmtVal(st.goal.category, st.actual)}</span>
                <span className="text-xs text-slate-500">de {fmtVal(st.goal.category, target)}</span>
                <span className="ml-auto text-xs font-semibold text-slate-300">{Math.round(st.pct * 100)}%</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={Math.round(st.pct * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className={cn("h-full", color)} style={{ width: `${Math.min(100, st.pct * 100)}%` }} />
              </div>
              <div className={cn("mt-1.5 text-[11px]", st.state === "atras" ? "text-amber-300" : st.state === "batida" ? "text-emerald-300" : "text-slate-400")}>
                {st.state === "batida" ? "✅ Meta batida."
                  : st.goal.period_type === "diaria" ? `Faltam ${fmtVal(st.goal.category, target - st.actual)} hoje.`
                  : `${st.state === "atras" ? "Atrás do ritmo" : "No ritmo"}: ${st.perDayNeeded != null ? `precisa de ${fmtVal(st.goal.category, st.perDayNeeded)} por dia útil até ${formatDateBR(st.window!.end)}` : ""}.`}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function GoalForm({ goal, today, onClose }: { goal: Goal; today: string; onClose: () => void }) {
  const actions = useActions();
  const { session } = useRepo();
  const [g, setG] = useState(goal);
  const [target, setTarget] = useState(goal.target_value ? String(goal.target_value) : "");
  useEffect(() => { setG(goal); setTarget(goal.target_value ? String(goal.target_value) : ""); }, [goal]);
  const setPeriod = (p: Goal["period_type"]) => setG({ ...g, period_type: p, ...periodPresets(today)[p] });
  return (
    <form className="mb-3 grid gap-2 rounded-xl border border-brand-500/30 bg-slate-950 p-3 md:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const t = Number(target.replace(",", "."));
        const ok = await actions.saveGoal({ ...g, title: g.title.trim() || `${CATEGORY_LABEL[g.category]} ${PERIOD_LABEL[g.period_type]}`, target_value: t });
        if (ok) onClose();
      }}>
      <label className="space-y-1 text-[11px] text-slate-400">O que medir
        <select className={field} value={g.category} onChange={(e) => setG({ ...g, category: e.target.value as Goal["category"] })}>
          {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-[11px] text-slate-400">Período
        <select className={field} value={g.period_type} onChange={(e) => setPeriod(e.target.value as Goal["period_type"])}>
          {Object.entries(PERIOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <label className="space-y-1 text-[11px] text-slate-400">Alvo
        <input className={field} inputMode="decimal" autoFocus placeholder="Ex.: 6" value={target} onChange={(e) => setTarget(e.target.value)} />
      </label>
      <label className="space-y-1 text-[11px] text-slate-400">De quem
        <select className={field} value={g.owner_id ? "eu" : "time"} onChange={(e) => setG({ ...g, owner_id: e.target.value === "eu" ? session.userId : null })}>
          <option value="eu">Minha</option>
          <option value="time">Do time (soma todos)</option>
        </select>
      </label>
      <label className="space-y-1 text-[11px] text-slate-400 md:col-span-2">Nome (opcional)
        <input className={field} placeholder={`${CATEGORY_LABEL[g.category]} ${PERIOD_LABEL[g.period_type]}`} value={g.title} onChange={(e) => setG({ ...g, title: e.target.value })} />
      </label>
      <p className="text-[10px] text-slate-500 md:col-span-2">Vale de {formatDateBR(g.start_date)} até {formatDateBR(g.end_date)}; o realizado reinicia a cada {g.period_type === "diaria" ? "dia" : g.period_type === "semanal" ? "semana (seg a dom)" : "mês"}.</p>
      <div className="flex justify-end gap-2 md:col-span-2">
        <Button size="sm" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button size="sm" variant="primary" type="submit" disabled={!(Number(target.replace(",", ".")) > 0)}>Salvar meta</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
function Daily({ today }: { today: string }) {
  const { data } = useSnapshot();
  const { session } = useRepo();
  const actions = useActions();
  const tz = session.timezone;
  const [date, setDate] = useState(today);
  const log = data?.dailyLogs.find((d) => d.owner_id === session.userId && d.log_date === date);
  const [score, setScore] = useState<number | null>(null);
  const [mood, setMood] = useState<Mood | null>(null);
  const [impact, setImpact] = useState("");
  const [learning, setLearning] = useState("");
  useEffect(() => {
    setScore(log?.day_score ?? null);
    setMood(log?.mood ?? null);
    setImpact(log?.day_impact ?? "");
    setLearning(log?.day_learning ?? "");
  }, [log, date]);
  if (!data) return null;
  const n = dayNumbers(data, tz, date, today);
  const tomorrow = addDays(date, 1);
  const tomorrowFu = data.followUps.filter((f) => f.status === "pendente" && f.due_date === tomorrow).length;
  const tomorrowVisits = data.visits.filter((v) => v.status !== "cancelada" && dateInTz(v.scheduled_at, tz) === tomorrow).length;
  const dirty = (log?.day_score ?? null) !== score || (log?.mood ?? null) !== mood || (log?.day_impact ?? "") !== impact || (log?.day_learning ?? "") !== learning;

  const items: [string, string | number, string?][] = [
    ["Visitas feitas", `${n.visitsDone}/${n.visitsPlanned}`],
    ["Follow-ups feitos", n.followUpsDone, n.noAnswer ? `+${n.noAnswer} sem resposta` : undefined],
    ["Propostas", n.proposals],
    ["Vendas", n.sales, n.mrr ? brl(n.mrr) : undefined],
    ["Novos leads", n.newLeads],
    ...(date === today ? [["Atrasados agora", n.overdueOpen] as [string, number]] : []),
  ];

  return (
    <Card>
      <SectionTitle right={
        <span className="flex items-center gap-1">
          <Button size="sm" variant="outline" aria-label="Dia anterior" onClick={() => setDate(addDays(date, -1))}>‹</Button>
          <span className="w-16 text-center text-xs text-slate-300">{date === today ? "Hoje" : formatDateBR(date)}</span>
          <Button size="sm" variant="outline" aria-label="Próximo dia" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>›</Button>
        </span>
      }>
        Daily comercial
      </SectionTitle>
      <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
        {items.map(([l, v, sub]) => (
          <div key={l} className={cn("rounded-xl bg-slate-950 p-2.5", l === "Atrasados agora" && Number(v) > 0 && "border border-amber-500/40")}>
            <div className="text-[10px] text-slate-500">{l}</div>
            <div className="font-mono text-lg font-extrabold text-white">{v}</div>
            {sub ? <div className="text-[10px] text-slate-500">{sub}</div> : null}
          </div>
        ))}
      </div>
      {date === today ? (
        <p className="mt-2 text-[11px] text-slate-400">Amanhã: {tomorrowVisits} visita(s) e {tomorrowFu} follow-up(s) na fila.</p>
      ) : null}

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-[11px] text-slate-400">Nota do dia</div>
          <div className="flex flex-wrap gap-1">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
              <button key={v} type="button" aria-pressed={score === v} onClick={() => setScore(score === v ? null : v)}
                className={cn("h-8 w-8 rounded-md text-xs font-bold", score === v ? "bg-brand-600 text-onaccent" : "bg-slate-800 text-slate-300")}>{v}</button>
            ))}
          </div>
          <div className="text-[11px] text-slate-400">Humor</div>
          <div className="flex flex-wrap gap-1">
            {MOODS.map((m) => (
              <button key={m.id} type="button" aria-pressed={mood === m.id} onClick={() => setMood(mood === m.id ? null : m.id)}
                className={cn("rounded-full border px-2.5 py-1 text-xs", mood === m.id ? "border-brand-500 bg-brand-600/20 text-brand-200" : "border-slate-700 text-slate-300")}>{m.label}</button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <textarea aria-label="Impacto do dia" className={cn(field, "min-h-16 text-xs")} placeholder="Impacto do dia: o que fez diferença?" value={impact} onChange={(e) => setImpact(e.target.value)} />
          <textarea aria-label="Aprendizado do dia" className={cn(field, "min-h-16 text-xs")} placeholder="Aprendizado: o que faria diferente amanhã?" value={learning} onChange={(e) => setLearning(e.target.value)} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-2">
        {log && !dirty ? <span className="text-[11px] text-emerald-300">✓ Daily salvo</span> : null}
        <Button size="sm" variant="primary" disabled={!dirty} onClick={() => void actions.saveDailyLog({
          id: log?.id ?? crypto.randomUUID(), log_date: date, day_score: score, mood, day_impact: impact.trim() || null, day_learning: learning.trim() || null,
        })}>Salvar Daily</Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
function FunnelBlock({ today }: { today: string }) {
  const { data } = useSnapshot();
  const enriched = useEnriched(data);
  const { session } = useRepo();
  const [by, setBy] = useState<"persona" | "segment" | "neighborhood" | "current_system">("persona");
  const accounts = useMemo(() => [...enriched.values()], [enriched]);
  if (!data) return null;
  const f = funnel(accounts);
  const rows = conversionBy(accounts, (a) => (by === "persona" ? PERSONA_LABEL[a.persona] : a[by]));
  const series = activitySeries(data, session.timezone, today, 14);
  const maxAct = Math.max(1, ...series.map((d) => d.visits + d.followUps));
  const losses = lossReasons(data, addDays(today, -90));
  const cycle = salesCycleDays(data);
  const max = Math.max(1, f[0].count);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <SectionTitle>Funil B2B</SectionTitle>
        <ul className="space-y-2">
          {f.map((st) => (
            <li key={st.id}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-semibold text-slate-200">{st.label} <span className="font-normal text-slate-500">· {st.hint}</span></span>
                <span className="font-mono text-slate-200">{st.count}{st.conv != null ? <span className="ml-1 text-slate-500">({Math.round(st.conv * 100)}%)</span> : null}</span>
              </div>
              <div className="mt-1 h-2.5 rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-gradient-to-r from-rose-600 to-emerald-400" style={{ width: `${(st.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10px] text-slate-500">% = conversão da etapa anterior. Ciclo médio de venda: {cycle != null ? `${Math.round(cycle)} dias` : "sem vendas ainda"}.</p>
      </Card>

      <MrrByBairro accounts={accounts} />

      <Card>
        <SectionTitle>Atividade (14 dias)</SectionTitle>
        <div className="flex h-28 items-end gap-1">
          {series.map((d) => (
            <div key={d.date} className="flex flex-1 flex-col items-center gap-0.5" title={`${formatDateBR(d.date)}: ${d.visits} visitas, ${d.followUps} follow-ups`}>
              <div className="flex w-full flex-col justify-end" style={{ height: "96px" }}>
                <div className="w-full rounded-t bg-slate-500" style={{ height: `${(d.followUps / maxAct) * 96}px` }} />
                <div className="w-full bg-brand-500" style={{ height: `${(d.visits / maxAct) * 96}px` }} />
              </div>
              <span className="text-[8px] text-slate-500">{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-3 text-[10px] text-slate-400">
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-brand-500" />Visitas</span>
          <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-slate-500" />Follow-ups</span>
        </div>
      </Card>

      <Card>
        <SectionTitle right={
          <select aria-label="Agrupar conversão por" className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-200" value={by} onChange={(e) => setBy(e.target.value as typeof by)}>
            <option value="persona">Persona</option>
            <option value="segment">Segmento</option>
            <option value="neighborhood">Bairro</option>
            <option value="current_system">Sistema atual</option>
          </select>
        }>
          Conversão (fechado ÷ decididos)
        </SectionTitle>
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase text-slate-500">
            <tr><th className="py-1 text-left">Grupo</th><th className="text-right">Ganhos</th><th className="text-right">Perdidos</th><th className="text-right">Abertos</th><th className="text-right">Conv.</th></tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((r) => (
              <tr key={r.key} className="border-t border-slate-800">
                <td className="max-w-36 truncate py-1.5 text-slate-200">{r.key}</td>
                <td className="text-right text-emerald-300">{r.won}</td>
                <td className="text-right text-red-300">{r.lost}</td>
                <td className="text-right text-slate-400">{r.open}</td>
                <td className="text-right font-mono text-slate-200">{r.rate != null ? `${Math.round(r.rate * 100)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <SectionTitle>Motivos de perda (90 dias)</SectionTitle>
        {losses.length ? (
          <ul className="space-y-1.5">
            {losses.map(([k, n]) => (
              <li key={k} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-300">{lossLabel(k)}</span>
                <span className="font-mono text-slate-200">{n}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-slate-500">Nenhuma perda registrada. Ao marcar “Perdido”, o motivo é obrigatório e aparece aqui.</p>}
      </Card>
    </div>
  );
}

/** MRR por bairro: fechado (cliente) e aberto (pipeline), para decidir onde vale concentrar rota. */
function MrrByBairro({ accounts }: { accounts: EnrichedAccount[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, { closed: number; open: number; clients: number }>();
    for (const a of accounts) {
      if (!a.mrr_closed && !a.mrr_open) continue;
      const k = a.neighborhood?.trim() || "Sem bairro";
      const r = m.get(k) ?? { closed: 0, open: 0, clients: 0 };
      r.closed += a.mrr_closed;
      r.open += a.mrr_open;
      if (a.mrr_closed) r.clients += 1;
      m.set(k, r);
    }
    return [...m.entries()].sort((x, y) => y[1].closed + y[1].open - (x[1].closed + x[1].open));
  }, [accounts]);
  const max = Math.max(1, ...rows.map(([, r]) => r.closed + r.open));
  const noValue = accounts.filter((a) => a.opps_active > 0 && !a.mrr_open).length;
  return (
    <Card>
      <SectionTitle>MRR por bairro</SectionTitle>
      {rows.length ? (
        <ul className="space-y-2">
          {rows.slice(0, 10).map(([k, r]) => (
            <li key={k}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate font-semibold text-slate-200">{k}{r.clients ? <span className="font-normal text-slate-500"> · {r.clients} cliente(s)</span> : null}</span>
                <span className="shrink-0 whitespace-nowrap font-mono text-slate-200">
                  <span className="text-emerald-300">{brl(r.closed)}</span>{r.open ? <span className="text-slate-500"> + {brl(r.open)}</span> : null}
                </span>
              </div>
              <div className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full bg-emerald-400" style={{ width: `${(r.closed / max) * 100}%` }} />
                <div className="h-full bg-gradient-to-r from-rose-600 to-amber-400 opacity-70" style={{ width: `${(r.open / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">Nenhum MRR registrado ainda.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-slate-400">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-400" />Fechado</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-500" />Pipeline aberto</span>
        {noValue ? <span className="text-amber-300">{noValue} conta(s) com oportunidade aberta sem MRR não aparecem aqui</span> : null}
      </div>
    </Card>
  );
}
