"use client";
// CRM: uma base (accounts) e quatro visões. Nada aqui grava direto: movimentos passam
// pelas RPCs (move_opportunity / set_account_status) via useMover.
import { AlertTriangle, ArrowDownUp, Clock, LayoutList, MapPinned, RefreshCw, Search, Target, TrendingUp, Workflow, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Card, cn, scoreColor } from "@/components/ui/primitives";
import { useEnriched, useRepo, useSnapshot } from "@/lib/data/hooks";
import {
  ACCOUNT_STATUS_LABEL, MISSING_FIELD_LABEL, NEXT_BEST_ACTION_LABEL, OPEN_STAGES, STAGE_LABEL,
} from "@/lib/domain/constants";
import { brl, dateInTz, diffDays, formatDateBR, monthStart, relativeDayLabel } from "@/lib/domain/dates";
import { type EnrichedAccount, weightedForecast } from "@/lib/domain/enrich";
import { lossLabel } from "@/lib/domain/pipeline";
import type { AccountStatus, OppStage, Opportunity } from "@/lib/domain/types";
import { useUi } from "@/lib/ui-store";
import { QuickMrr, needsMrr } from "./quick-mrr";
import { BulkBar } from "./bulk-bar";
import { useMover } from "./move-dialog";
import { LeadControls, SystemSelect, TempPill } from "./lead-controls";

type Tab = "rapida" | "tabela" | "pipeline" | "regioes" | "recuperacao";
const TABS: { id: Tab; label: string; icon: typeof LayoutList }[] = [
  { id: "rapida", label: "⚡ Visão Rápida", icon: Zap },
  { id: "tabela", label: "Tabela Completa", icon: LayoutList },
  { id: "pipeline", label: "Pipeline & Prospecção", icon: TrendingUp },
  { id: "regioes", label: "Regiões", icon: MapPinned },
  { id: "recuperacao", label: "Recuperação & Onboarding", icon: RefreshCw },
];

/** Dias parado na etapa a partir do qual o card fica âmbar (deal "esfriando"). */
const STALE_DAYS = 7;

const ENTRY: AccountStatus[] = ["novo_lead", "lead_importado", "a_validar", "lead_frio"];
const PROSPECT_COLUMNS: { id: AccountStatus; label: string; members: AccountStatus[] }[] = [
  { id: "novo_lead", label: "Entrada", members: ENTRY },
  { id: "primeiro_contato", label: "Primeiro Contato", members: ["primeiro_contato"] },
  { id: "discovery", label: "Discovery", members: ["discovery"] },
  { id: "agendado", label: "Agendado", members: ["agendado"] },
  { id: "demo_realizada", label: "Demo Realizada", members: ["demo_realizada"] },
  { id: "proposta_enviada", label: "Proposta", members: ["proposta_enviada"] },
  { id: "negociacao", label: "Negociação", members: ["negociacao"] },
  { id: "fechado", label: "Fechado ✅", members: ["fechado"] },
  { id: "perdido", label: "Perdido ❌", members: ["perdido"] },
];

export function CrmView() {
  const [tab, setTab] = useState<Tab>("rapida");
  const [board, setBoard] = useState<"prospeccao" | "oportunidades">("prospeccao");
  const [q, setQ] = useState("");
  const [bairro, setBairro] = useState("");
  const [onlyNoAction, setOnlyNoAction] = useState(false);
  const { data, isLoading } = useSnapshot();
  const enriched = useEnriched(data);
  const { session } = useRepo();
  const today = dateInTz(new Date(), session.timezone);

  const all = useMemo(() => [...enriched.values()], [enriched]);
  const bairros = useMemo(
    () => [...new Set(all.map((a) => a.neighborhood?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [all],
  );
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter(
      (a) =>
        (!term || [a.name, a.neighborhood, a.segment, a.current_system, a.decision_maker_name].some((v) => v?.toLowerCase().includes(term))) &&
        (!bairro || (bairro === "__none" ? !a.neighborhood : a.neighborhood === bairro)) &&
        (!onlyNoAction || a.missing_field === "follow_up"),
    );
  }, [all, q, bairro, onlyNoAction]);

  if (isLoading || !data) return <div className="py-20 text-center text-sm text-slate-500">Carregando CRM…</div>;

  const noAction = all.filter((a) => a.missing_field === "follow_up").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-white">CRM &amp; Pipeline</h1>
          <p className="text-xs text-slate-400">{all.length} contas · uma base só, cinco visões. Tudo editável com 1 clique, sem abrir a ficha.</p>
        </div>
        <div role="tablist" className="-mx-1 flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold",
                tab === t.id ? "bg-brand-600 text-onaccent" : "text-slate-400 hover:text-slate-200",
              )}
            >
              {t.id !== "rapida" ? <t.icon size={14} /> : null} {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab !== "regioes" && tab !== "recuperacao" ? (
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm">
            <Search size={14} className="text-slate-500" />
            <input
              aria-label="Filtrar contas"
              className="w-full bg-transparent text-slate-200 placeholder:text-slate-500 focus:outline-none"
              placeholder="Filtrar por nome, bairro, segmento, sistema…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <select
            aria-label="Bairro"
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            value={bairro}
            onChange={(e) => setBairro(e.target.value)}
          >
            <option value="">Todos os bairros</option>
            {bairros.map((b) => <option key={b} value={b}>{b}</option>)}
            <option value="__none">Sem bairro</option>
          </select>
          {noAction ? (
            <button
              type="button"
              onClick={() => setOnlyNoAction((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold",
                onlyNoAction ? "border-amber-400 bg-amber-500/20 text-amber-200" : "border-amber-500/30 bg-amber-500/10 text-amber-300",
              )}
            >
              <AlertTriangle size={13} /> {noAction} sem próxima ação
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === "rapida" ? <QuickView rows={filtered} opps={data.opportunities} today={today} /> : null}
      {tab === "tabela" ? <AccountsTable rows={filtered} today={today} /> : null}
      {tab === "pipeline" ? (
        <div className="space-y-3">
          <div role="group" aria-label="Quadro" className="inline-flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1 text-xs font-semibold">
            {([["prospeccao", "Prospecção (contas)", Workflow], ["oportunidades", "Pipeline (oportunidades)", TrendingUp]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" aria-pressed={board === id} onClick={() => setBoard(id)}
                className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5", board === id ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200")}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          {board === "prospeccao" ? <ProspectBoard rows={filtered} today={today} /> : (
            <PipelineBoard
              opps={data.opportunities.filter((o) => filtered.some((a) => a.id === o.account_id))}
              enriched={enriched}
              today={today}
            />
          )}
        </div>
      ) : null}
      {tab === "recuperacao" ? <RecoveryView rows={all} opps={data.opportunities} today={today} /> : null}
      {tab === "regioes" ? (
        <RegionsView
          rows={all}
          opps={data.opportunities}
          onPick={(b) => {
            setBairro(b);
            setTab("tabela");
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------
type SortKey = "score" | "next" | "last" | "name";
const SORTS: { id: SortKey; label: string }[] = [
  { id: "next", label: "Próxima ação" },
  { id: "score", label: "Score" },
  { id: "last", label: "Sem contato há mais tempo" },
  { id: "name", label: "Nome" },
];

function AccountsTable({ rows, today }: { rows: EnrichedAccount[]; today: string }) {
  const openDrawer = useUi((s) => s.openDrawer);
  const [sort, setSort] = useState<SortKey>("next");
  const [limit, setLimit] = useState(60);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sorted = useMemo(() => {
    const r = [...rows];
    const due = (a: EnrichedAccount) => a.next_followup?.due_date ?? "9999";
    if (sort === "score") r.sort((a, b) => b.commercial_score - a.commercial_score);
    if (sort === "next") r.sort((a, b) => due(a).localeCompare(due(b)) || b.commercial_score - a.commercial_score);
    if (sort === "last") r.sort((a, b) => (a.last_interaction_at ?? "").localeCompare(b.last_interaction_at ?? ""));
    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    return r;
  }, [rows, sort]);

  const visibleIds = sorted.slice(0, limit).map((a) => a.id);
  const allPicked = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));
  return (
    <>
    <Card className="p-0">
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5 text-xs text-slate-400">
        <label className="flex items-center gap-2">
          <input type="checkbox" aria-label="Selecionar todas as visíveis" checked={allPicked}
            onChange={() => setPicked(allPicked ? new Set() : new Set(visibleIds))} />
          {rows.length} contas{picked.size ? ` · ${picked.size} selecionada(s)` : ""}
        </label>
        <label className="flex items-center gap-1.5">
          <ArrowDownUp size={13} /> Ordenar
          <select aria-label="Ordenar" className="rounded-md bg-slate-800 px-2 py-1 text-slate-200" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </div>
      {/* Desktop: tabela */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr className="border-b border-slate-800">
              <th className="w-8 pl-4 py-2"><span className="sr-only">Selecionar</span></th>
              <th className="px-4 py-2">Restaurante</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2 text-center">Score</th>
              <th className="px-2 py-2">Próxima ação</th>
              <th className="px-2 py-2">Bairro</th>
              <th className="px-2 py-2">Sistema</th>
              <th className="px-2 py-2 text-right">MRR</th>
              <th className="px-4 py-2">Falta</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((a) => {
              const fu = a.next_followup;
              const late = fu && fu.due_date < today;
              return (
                <tr key={a.id} onClick={() => openDrawer(a.id)} className={cn("cursor-pointer border-b border-slate-800/60 hover:bg-slate-800/40", picked.has(a.id) && "bg-brand-600/10")}>
                  <td className="pl-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Selecionar ${a.name}`} checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
                  </td>
                  <td className="max-w-60 px-4 py-2.5">
                    <div className="truncate font-semibold text-slate-100">{a.name}</div>
                    <div className="truncate text-[11px] text-slate-500">{a.segment ?? "—"}</div>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <Badge>{ACCOUNT_STATUS_LABEL[a.status]}</Badge>
                      <TempPill acc={a} />
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className={cn("rounded-md px-1.5 py-0.5 font-mono font-bold", scoreColor(a.commercial_score))}>{a.commercial_score}</span>
                  </td>
                  <td className="max-w-64 px-2 py-2.5">
                    {fu ? (
                      <>
                        <div className={cn("text-[11px] font-semibold", late ? "text-red-300" : fu.due_date === today ? "text-amber-300" : "text-slate-400")}>
                          {relativeDayLabel(fu.due_date, today)}
                        </div>
                        <div className="truncate text-slate-300">{fu.title}</div>
                      </>
                    ) : (
                      <span className="text-slate-500">{NEXT_BEST_ACTION_LABEL[a.next_best_action]}</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-slate-300">{a.neighborhood ?? "—"}</td>
                  <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}><SystemSelect acc={a} /></td>
                  <td className="px-2 py-2.5 text-right font-mono text-slate-300">
                    {a.mrr_closed ? brl(a.mrr_closed) : a.mrr_open ? <span className="text-slate-500">{brl(a.mrr_open)}</span> : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {a.missing_field ? <span className="text-amber-300">{MISSING_FIELD_LABEL[a.missing_field]}</span> : <span className="text-emerald-400">ok</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Celular: cartões */}
      <ul className="divide-y divide-slate-800 md:hidden">
        {sorted.slice(0, limit).map((a) => {
          const fu = a.next_followup;
          return (
            <li key={a.id} className={cn("flex items-start", picked.has(a.id) && "bg-brand-600/10")}>
              <input type="checkbox" aria-label={`Selecionar ${a.name}`} className="ml-4 mt-4 h-4 w-4 shrink-0" checked={picked.has(a.id)} onChange={() => toggle(a.id)} />
              <button type="button" onClick={() => openDrawer(a.id)} className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left">
                <span className={cn("mt-0.5 rounded-md px-1.5 py-0.5 font-mono text-xs font-bold", scoreColor(a.commercial_score))}>{a.commercial_score}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-100">{a.name}</span>
                  <span className="block truncate text-[11px] text-slate-500">
                    {ACCOUNT_STATUS_LABEL[a.status]} · {a.neighborhood ?? "sem bairro"}
                  </span>
                  <span className={cn("block truncate text-[11px]", fu && fu.due_date < today ? "text-red-300" : "text-slate-400")}>
                    {fu ? `${relativeDayLabel(fu.due_date, today)}: ${fu.title}` : a.missing_field === "follow_up" ? "⚠️ Sem próxima ação" : NEXT_BEST_ACTION_LABEL[a.next_best_action]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {sorted.length > limit ? (
        <button type="button" onClick={() => setLimit((l) => l + 100)} className="w-full border-t border-slate-800 py-3 text-xs font-semibold text-brand-300 hover:bg-slate-800/40">
          Mostrar mais ({sorted.length - limit})
        </button>
      ) : null}
      {!rows.length ? <p className="p-6 text-center text-sm text-slate-500">Nenhuma conta com esse filtro.</p> : null}
    </Card>
    <BulkBar ids={[...picked]} onDone={() => setPicked(new Set())} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Kanban genérico (arrastar no desktop + menu "Mover" que funciona no celular)
// ---------------------------------------------------------------------------
function Column<T extends string>({
  id, title, sub, count, children, onDropCard, highlight,
}: {
  id: T; title: string; sub?: string; count: number; children: React.ReactNode; onDropCard: (cardId: string, col: T) => void; highlight?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <section
      aria-label={title}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const cardId = e.dataTransfer.getData("text/plain");
        if (cardId) onDropCard(cardId, id);
      }}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-2xl border bg-slate-900/50 md:w-64",
        over ? "border-brand-500 bg-brand-500/5" : "border-slate-800",
      )}
    >
      <header className="border-b border-slate-800 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className={cn("text-xs font-bold text-slate-200", highlight)}>{title}</h3>
          <span className="rounded bg-slate-800 px-1.5 text-[10px] font-semibold text-slate-400">{count}</span>
        </div>
        {sub ? <div className="mt-0.5 text-[10px] text-slate-500">{sub}</div> : null}
      </header>
      <div className="flex max-h-[62dvh] flex-col gap-2 overflow-y-auto p-2">{children}</div>
    </section>
  );
}

function MoveMenu<T extends string>({ value, options, onChange, label }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as T)}
      className="max-w-full rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 text-[10px] text-slate-300"
    >
      {options.map((o) => <option key={o.id} value={o.id}>{o.id === value ? `Mover… (${o.label})` : `→ ${o.label}`}</option>)}
    </select>
  );
}

const CARD_LIMIT = 40;

function ProspectBoard({ rows, today }: { rows: EnrichedAccount[]; today: string }) {
  const openDrawer = useUi((s) => s.openDrawer);
  const mover = useMover();
  const byCol = useMemo(() => {
    const m = new Map<AccountStatus, EnrichedAccount[]>();
    for (const c of PROSPECT_COLUMNS) m.set(c.id, []);
    for (const a of rows) {
      const col = PROSPECT_COLUMNS.find((c) => c.members.includes(a.status))!;
      m.get(col.id)!.push(a);
    }
    for (const list of m.values()) list.sort((a, b) => b.commercial_score - a.commercial_score);
    return m;
  }, [rows]);

  const move = (id: string, target: AccountStatus) => {
    const a = rows.find((r) => r.id === id);
    if (!a || a.status === target || (target === "novo_lead" && ENTRY.includes(a.status))) return;
    mover({ kind: "account", id, target });
  };
  const options = PROSPECT_COLUMNS.map((c) => ({ id: c.id, label: c.label }));

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="flex gap-3">
        {PROSPECT_COLUMNS.map((c) => {
          const list = byCol.get(c.id)!;
          return (
            <Column key={c.id} id={c.id} title={c.label} count={list.length} onDropCard={move}>
              {list.slice(0, CARD_LIMIT).map((a) => {
                const fu = a.next_followup;
                return (
                  <article
                    key={a.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", a.id)}
                    onClick={() => openDrawer(a.id)}
                    className="cursor-pointer rounded-xl border border-slate-800 bg-slate-950 p-2.5 hover:border-slate-600"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 text-xs font-semibold text-slate-100">{a.name}</div>
                      <span className={cn("rounded px-1 font-mono text-[10px] font-bold", scoreColor(a.commercial_score))}>{a.commercial_score}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-slate-500">{a.neighborhood ?? "sem bairro"} · {a.current_system ?? "sistema ?"}</div>
                    <div className={cn("mt-1 truncate text-[10px]", fu ? (fu.due_date < today ? "text-red-300" : "text-slate-400") : "text-amber-300")}>
                      {fu ? `${relativeDayLabel(fu.due_date, today)}: ${fu.title}` : a.status === "fechado" || a.status === "perdido" ? (a.loss_reason ? lossLabel(a.loss_reason) : "") : "⚠️ sem próxima ação"}
                    </div>
                    <div className="mt-1.5">
                      <MoveMenu label={`Mover ${a.name}`} value={c.id} options={options} onChange={(v) => move(a.id, v)} />
                    </div>
                  </article>
                );
              })}
              {list.length > CARD_LIMIT ? (
                <p className="px-1 text-center text-[10px] text-slate-500">+{list.length - CARD_LIMIT} — use o filtro ou a Tabela</p>
              ) : null}
            </Column>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pipeline (oportunidades) com forecast por coluna
// ---------------------------------------------------------------------------
function PipelineBoard({ opps, enriched, today }: { opps: Opportunity[]; enriched: Map<string, EnrichedAccount>; today: string }) {
  const openDrawer = useUi((s) => s.openDrawer);
  const mover = useMover();
  const month = monthStart(today);
  const cols: { id: OppStage; label: string }[] = [
    ...OPEN_STAGES.map((s) => ({ id: s, label: STAGE_LABEL[s] })),
    { id: "fechado", label: "Fechado no mês ✅" },
    { id: "perdido", label: "Perdido no mês ❌" },
  ];
  const visible = opps.filter(
    (o) =>
      OPEN_STAGES.includes(o.stage) ||
      (o.stage === "fechado" && (o.closed_at ?? "") >= month) ||
      (o.stage === "perdido" && dateInTz(o.stage_changed_at) >= month),
  );
  const open = opps.filter((o) => OPEN_STAGES.includes(o.stage));
  const wonMonth = visible.filter((o) => o.stage === "fechado");
  const lostMonth = visible.filter((o) => o.stage === "perdido");
  const stale = open.filter((o) => diffDays(dateInTz(o.stage_changed_at), today) >= STALE_DAYS).length;

  const move = (id: string, target: OppStage) => {
    const o = opps.find((x) => x.id === id);
    if (!o || o.stage === target) return;
    mover({ kind: "opp", id, target });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi icon={Target} label="Pipeline aberto" value={brl(open.reduce((s, o) => s + o.mrr_value, 0))}
          sub={`${open.length} oportunidades${open.filter(needsMrr).length ? ` · ${open.filter(needsMrr).length} sem MRR` : ""}`} warn={open.some(needsMrr)} />
        <Kpi icon={TrendingUp} label="Forecast ponderado" value={brl(weightedForecast(open))} sub="MRR × probabilidade da etapa" />
        <Kpi icon={TrendingUp} label="Fechado no mês" value={brl(wonMonth.reduce((s, o) => s + o.mrr_value, 0))} sub={`${wonMonth.length} vendas · ${lostMonth.length} perdidas`} />
        <Kpi icon={Clock} label={`Paradas ≥ ${STALE_DAYS} dias`} value={String(stale)} sub="sem mudar de etapa" warn={stale > 0} />
      </div>
      {!opps.length ? (
        <Card className="text-center text-sm text-slate-400">
          Nenhuma oportunidade ainda. Elas nascem sozinhas no check-in (Quick Log) quando há interesse, ao arrastar uma conta para
          Demo/Proposta na Prospecção, ou pelo botão “Criar oportunidade” na ficha do cliente.
        </Card>
      ) : null}
      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="flex gap-3">
          {cols.map((c) => {
            const list = visible.filter((o) => o.stage === c.id).sort((a, b) => b.mrr_value - a.mrr_value);
            const sum = list.reduce((s, o) => s + o.mrr_value, 0);
            const weighted = list.reduce((s, o) => s + o.mrr_value * (o.probability / 100), 0);
            return (
              <Column
                key={c.id}
                id={c.id}
                title={c.label}
                count={list.length}
                sub={OPEN_STAGES.includes(c.id) ? `${brl(sum)} · ponderado ${brl(weighted)}` : brl(sum)}
                onDropCard={move}
              >
                {list.map((o) => {
                  const a = enriched.get(o.account_id);
                  const days = diffDays(dateInTz(o.stage_changed_at), today);
                  const isStale = OPEN_STAGES.includes(o.stage) && days >= STALE_DAYS;
                  const fu = a?.next_followup;
                  return (
                    <article
                      key={o.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/plain", o.id)}
                      onClick={() => openDrawer(o.account_id)}
                      className={cn(
                        "cursor-pointer rounded-xl border bg-slate-950 p-2.5 hover:border-slate-600",
                        isStale ? "border-amber-500/40" : "border-slate-800",
                      )}
                    >
                      <div className="text-xs font-semibold text-slate-100">{a?.name ?? o.title}</div>
                      {o.title !== a?.name ? <div className="truncate text-[10px] text-slate-500">{o.title}</div> : null}
                      <div className="mt-1 flex items-center justify-between text-[11px]">
                        <span className={cn("font-mono font-bold", o.mrr_value ? "text-emerald-300" : "text-slate-500")}>
                          {o.mrr_value ? `${brl(o.mrr_value)}/mês` : "MRR a definir"}
                        </span>
                        <span className="text-slate-500">{o.probability}%</span>
                      </div>
                      <div className={cn("mt-1 text-[10px]", isStale ? "text-amber-300" : "text-slate-500")}>
                        {o.stage === "fechado" && o.closed_at
                          ? `Fechado em ${formatDateBR(o.closed_at)}`
                          : o.stage === "perdido"
                            ? lossLabel(o.loss_category)
                            : `${days === 0 ? "Entrou hoje" : `${days} dia${days > 1 ? "s" : ""} na etapa`}${isStale ? " · esfriando" : ""}`}
                      </div>
                      {fu && OPEN_STAGES.includes(o.stage) ? (
                        <div className={cn("mt-0.5 truncate text-[10px]", fu.due_date < today ? "text-red-300" : "text-slate-400")}>
                          {relativeDayLabel(fu.due_date, today)}: {fu.title}
                        </div>
                      ) : null}
                      {needsMrr(o) ? <QuickMrr opp={o} className="mt-1.5" /> : null}
                      <div className="mt-1.5">
                        <MoveMenu label={`Mover ${a?.name ?? o.title}`} value={o.stage} options={cols} onChange={(v) => move(o.id, v)} />
                      </div>
                    </article>
                  );
                })}
              </Column>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, warn }: { icon: typeof Target; label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card className={cn("p-3", warn && "border-amber-500/40")}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <Icon size={12} /> {label}
      </div>
      <div className={cn("mt-1 font-mono text-lg font-extrabold", warn ? "text-amber-300" : "text-white")}>{value}</div>
      {sub ? <div className="text-[10px] text-slate-500">{sub}</div> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Regiões / bairros
// ---------------------------------------------------------------------------
function RegionsView({ rows, opps, onPick }: { rows: EnrichedAccount[]; opps: Opportunity[]; onPick: (bairro: string) => void }) {
  const stats = useMemo(() => {
    const m = new Map<string, { bairro: string; total: number; entrada: number; ativos: number; clientes: number; perdidos: number; pipeline: number; mrr: number; semAcao: number }>();
    const accBairro = new Map(rows.map((a) => [a.id, a.neighborhood?.trim() || "__none"]));
    for (const a of rows) {
      const k = a.neighborhood?.trim() || "__none";
      const s = m.get(k) ?? { bairro: k, total: 0, entrada: 0, ativos: 0, clientes: 0, perdidos: 0, pipeline: 0, mrr: 0, semAcao: 0 };
      s.total++;
      if (a.status === "fechado") s.clientes++;
      else if (a.status === "perdido") s.perdidos++;
      else if (ENTRY.includes(a.status)) s.entrada++;
      else s.ativos++;
      if (a.missing_field === "follow_up") s.semAcao++;
      m.set(k, s);
    }
    for (const o of opps) {
      const s = m.get(accBairro.get(o.account_id) ?? "__none");
      if (!s) continue;
      if (OPEN_STAGES.includes(o.stage)) s.pipeline += o.mrr_value;
      if (o.stage === "fechado") s.mrr += o.mrr_value;
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [rows, opps]);
  const max = Math.max(1, ...stats.map((s) => s.total));

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Onde está a base e onde está o dinheiro. Toque num bairro para abrir a lista filtrada; monte a rota do dia em <b>Rotas</b>.
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {stats.map((s) => {
          const decided = s.clientes + s.perdidos;
          return (
            <button
              key={s.bairro}
              type="button"
              onClick={() => onPick(s.bairro)}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 text-left hover:border-slate-600"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-100">{s.bairro === "__none" ? "Sem bairro (completar cadastro)" : s.bairro}</span>
                <span className="text-xs text-slate-400">{s.total} contas</span>
              </div>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-800" style={{ width: `${Math.max(12, (s.total / max) * 100)}%` }}>
                <span className="bg-slate-500" style={{ width: `${(s.entrada / s.total) * 100}%` }} />
                <span className="bg-brand-500" style={{ width: `${(s.ativos / s.total) * 100}%` }} />
                <span className="bg-emerald-500" style={{ width: `${(s.clientes / s.total) * 100}%` }} />
                <span className="bg-red-500/70" style={{ width: `${(s.perdidos / s.total) * 100}%` }} />
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] text-slate-400">
                <span><b className="text-slate-200">{s.entrada}</b> entrada</span>
                <span><b className="text-brand-300">{s.ativos}</b> em contato</span>
                <span><b className="text-emerald-300">{s.clientes}</b> clientes</span>
                <span><b className="text-red-300">{s.perdidos}</b> perdidos</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-slate-500">
                <span>Pipeline {brl(s.pipeline)}</span>
                <span>MRR {brl(s.mrr)}</span>
                <span>Conversão {decided ? `${Math.round((s.clientes / decided) * 100)}%` : "—"}</span>
                {s.semAcao ? <span className="text-amber-300">{s.semAcao} sem próxima ação</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ⚡ Visão Rápida: cards com todos os controles de 1 clique abertos
// ---------------------------------------------------------------------------
const QUICK_LIMIT = 24;

function QuickView({ rows, opps, today }: { rows: EnrichedAccount[]; opps: Opportunity[]; today: string }) {
  const openDrawer = useUi((s) => s.openDrawer);
  const [limit, setLimit] = useState(QUICK_LIMIT);
  const [hideDone, setHideDone] = useState(true);
  const openOpp = useMemo(() => {
    const m = new Map<string, Opportunity>();
    for (const o of opps) if (o.stage !== "fechado" && o.stage !== "perdido" && !m.has(o.account_id)) m.set(o.account_id, o);
    return m;
  }, [opps]);
  const sorted = useMemo(() => {
    const due = (a: EnrichedAccount) => a.next_followup?.due_date ?? "9999";
    return rows
      .filter((a) => !hideDone || (a.status !== "fechado" && a.status !== "perdido"))
      .sort((a, b) => due(a).localeCompare(due(b)) || b.commercial_score - a.commercial_score);
  }, [rows, hideDone]);
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-slate-400">
        <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Esconder fechados e perdidos
        <span className="text-slate-500">· {sorted.length} conta(s), próxima ação primeiro</span>
      </label>
      <ul className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
        {sorted.slice(0, limit).map((a) => {
          const fu = a.next_followup;
          return (
            <li key={a.id} className="min-w-0 space-y-2.5 rounded-xl border border-slate-800 bg-slate-900 p-3.5">
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => openDrawer(a.id)} className="min-w-0 text-left">
                  <div className="truncate text-sm font-bold text-white underline decoration-slate-600 decoration-dotted underline-offset-2 hover:text-brand-300">{a.name}</div>
                  <div className="truncate text-[11px] text-slate-500">{[a.neighborhood ?? "sem bairro", a.segment].filter(Boolean).join(" · ")}</div>
                </button>
                <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs font-bold", scoreColor(a.commercial_score))}>{a.commercial_score}</span>
              </div>
              <div className={cn("truncate text-[11px]", fu && fu.due_date < today ? "text-red-300" : fu?.due_date === today ? "text-amber-300" : "text-slate-400")}>
                {fu ? `${relativeDayLabel(fu.due_date, today)}: ${fu.title}` : a.missing_field === "follow_up" ? "⚠️ Sem próxima ação" : NEXT_BEST_ACTION_LABEL[a.next_best_action]}
              </div>
              <LeadControls acc={a} openOpp={openOpp.get(a.id)} />
            </li>
          );
        })}
      </ul>
      {sorted.length > limit ? (
        <button type="button" onClick={() => setLimit((l) => l + QUICK_LIMIT)} className="w-full rounded-xl border border-slate-800 py-3 text-xs font-semibold text-brand-300 hover:bg-slate-800/40">
          Mostrar mais ({sorted.length - limit})
        </button>
      ) : null}
      {!sorted.length ? <p className="p-6 text-center text-sm text-slate-500">Nenhuma conta com esse filtro.</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 🔄 Recuperação (+15d / +30d sem contato) & Onboarding pós-venda
// ---------------------------------------------------------------------------
function RecoveryView({ rows, opps, today }: { rows: EnrichedAccount[]; opps: Opportunity[]; today: string }) {
  const openDrawer = useUi((s) => s.openDrawer);
  const openOpp = new Map<string, Opportunity>();
  for (const o of opps) if (o.stage !== "fechado" && o.stage !== "perdido" && !openOpp.has(o.account_id)) openOpp.set(o.account_id, o);
  // dias sem contato: última interação, ou primeiro contato; contas nunca tocadas ficam de fora (são prospecção, não recuperação)
  const idle = (a: EnrichedAccount) => {
    const ref = a.last_interaction_at ?? a.first_contact_date;
    return ref ? diffDays(ref.length > 10 ? dateInTz(ref) : ref, today) : null;
  };
  const active = rows.filter((a) => a.status !== "fechado" && a.status !== "perdido");
  const d30 = active.filter((a) => (idle(a) ?? 0) >= 30).sort((a, b) => (idle(b) ?? 0) - (idle(a) ?? 0));
  const d15 = active.filter((a) => { const d = idle(a) ?? 0; return d >= 15 && d < 30; }).sort((a, b) => (idle(b) ?? 0) - (idle(a) ?? 0));
  const lost = rows.filter((a) => a.status === "perdido");
  const closedAt = new Map<string, string>();
  for (const o of opps) if (o.stage === "fechado" && o.closed_at && (closedAt.get(o.account_id) ?? "") < o.closed_at) closedAt.set(o.account_id, o.closed_at);
  const onboarding = rows
    .filter((a) => a.status === "fechado")
    .map((a) => ({ a, days: closedAt.has(a.id) ? diffDays(dateInTz(closedAt.get(a.id)!), today) : null }))
    .sort((x, y) => (x.days ?? 999) - (y.days ?? 999));

  const Row = ({ a, right }: { a: EnrichedAccount; right: string }) => (
    <li className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => openDrawer(a.id)} className="min-w-0 text-left">
          <div className="truncate text-sm font-semibold text-white underline decoration-slate-600 decoration-dotted underline-offset-2">{a.name}</div>
          <div className="truncate text-[11px] text-slate-500">{ACCOUNT_STATUS_LABEL[a.status]} · {a.neighborhood ?? "sem bairro"}</div>
        </button>
        <span className="shrink-0 whitespace-nowrap font-mono text-[11px] font-bold text-amber-300">{right}</span>
      </div>
      <LeadControls acc={a} openOpp={openOpp.get(a.id)} compact />
    </li>
  );
  const Col = ({ title, hint, items, tone }: { title: string; hint: string; items: React.ReactNode[]; tone: string }) => (
    <Card className={cn("min-w-0", tone)}>
      <h2 className="text-sm font-bold text-white">{title} <span className="font-mono text-slate-400">({items.length})</span></h2>
      <p className="mb-3 text-[11px] text-slate-500">{hint}</p>
      {items.length ? <ul className="space-y-2">{items.slice(0, 30)}</ul> : <p className="text-sm text-slate-500">Nada aqui. 👏</p>}
      {items.length > 30 ? <p className="mt-2 text-center text-[11px] text-slate-500">+{items.length - 30} — use a Tabela, ordenada por “sem contato há mais tempo”</p> : null}
    </Card>
  );
  return (
    <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
      <Col title="🔥 +30 dias sem contato" hint="Esfriou. Reative com WhatsApp de valor ou visita surpresa." tone="border-red-500/30"
        items={d30.map((a) => <Row key={a.id} a={a} right={`${idle(a)}d`} />)} />
      <Col title="⏳ +15 dias sem contato" hint="Ainda dá tempo: um toque agora evita a perda." tone="border-amber-500/30"
        items={d15.map((a) => <Row key={a.id} a={a} right={`${idle(a)}d`} />)} />
      <div className="space-y-4">
        <Col title="🚀 Onboarding pós-venda" hint="Clientes fechados: check-in de 7 dias, depois 30 dias. Cliente bem ativado não cancela." tone="border-emerald-500/30"
          items={onboarding.map(({ a, days }) => <Row key={a.id} a={a} right={days === null ? "cliente" : days === 0 ? "hoje" : `há ${days}d`} />)} />
        <Col title="♻️ Perdidos (recuperação 90 dias)" hint="Motivo registrado na ficha. Reabra mudando a etapa." tone=""
          items={lost.map((a) => <Row key={a.id} a={a} right={a.loss_reason ? lossLabel(a.loss_reason) : "perdido"} />)} />
      </div>
    </div>
  );
}
