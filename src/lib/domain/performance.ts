// Performance: metas, Daily automática, funil e conversões. Nada digitado à mão:
// tudo sai de visitas, oportunidades, follow-ups e contas. Metas espelham vw_goal_progress (0010).
import { addDays, dateInTz, diffDays, monthStart } from "./dates";
import type { EnrichedAccount } from "./enrich";
import type { Goal, Snapshot } from "./types";

/** Segunda-feira da semana (igual a date_trunc('week') do Postgres). */
export function weekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return addDays(date, -((dow + 6) % 7));
}

export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Janela do período atual da meta, recortada pela validade. null = meta fora da validade hoje. */
export function goalWindow(g: Pick<Goal, "period_type" | "start_date" | "end_date">, today: string) {
  const ps = g.period_type === "diaria" ? today : g.period_type === "semanal" ? weekStart(today) : monthStart(today);
  const pe = g.period_type === "diaria" ? today : g.period_type === "semanal" ? addDays(weekStart(today), 6) : monthEnd(today);
  const start = ps > g.start_date ? ps : g.start_date;
  const end = pe < g.end_date ? pe : g.end_date;
  return start <= end ? { start, end } : null;
}

export function goalActual(g: Goal, s: Snapshot, tz: string, today: string): number {
  const w = goalWindow(g, today);
  if (!w) return 0;
  const inW = (d: string | null | undefined) => !!d && d >= w.start && d <= w.end;
  const mine = (owner: string | null) => g.owner_id == null || owner === g.owner_id;
  switch (g.category) {
    case "visitas":
      return s.visits.filter((v) => v.status === "realizada" && mine(v.owner_id) && v.completed_at && inW(dateInTz(v.completed_at, tz))).length;
    case "demonstracoes":
      return s.visits.filter((v) => v.status === "realizada" && v.visit_type === "demonstracao" && mine(v.owner_id) && v.completed_at && inW(dateInTz(v.completed_at, tz))).length;
    case "propostas":
      return s.opportunities.filter((o) => inW(o.proposal_sent_at) && mine(o.owner_id)).length;
    case "vendas":
      return s.opportunities.filter((o) => o.stage === "fechado" && inW(o.closed_at) && mine(o.owner_id)).length;
    case "receita_mrr":
      return s.opportunities.filter((o) => o.stage === "fechado" && inW(o.closed_at) && mine(o.owner_id)).reduce((t, o) => t + Number(o.mrr_value), 0);
    case "novos_leads":
      return s.accounts.filter((a) => mine(a.owner_id) && inW(dateInTz(a.created_at, tz))).length;
  }
}

export interface GoalStatus {
  goal: Goal;
  actual: number;
  pct: number;
  window: { start: string; end: string } | null;
  /** quanto deveria ter feito até hoje para chegar no fim do período no ritmo */
  expected: number;
  /** por dia útil restante (inclui hoje) */
  perDayNeeded: number | null;
  state: "batida" | "no_ritmo" | "atras" | "fora";
}

/** Dias úteis (seg-sáb: rotina de campo de restaurante) entre a e b, inclusive. */
export function workdays(a: string, b: string): number {
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) {
    const [y, m, dd] = d.split("-").map(Number);
    if (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() !== 0) n++;
  }
  return n;
}

export function goalStatus(g: Goal, s: Snapshot, tz: string, today: string): GoalStatus {
  const w = goalWindow(g, today);
  const actual = goalActual(g, s, tz, today);
  const target = Number(g.target_value);
  if (!w) return { goal: g, actual, pct: 0, window: null, expected: 0, perDayNeeded: null, state: "fora" };
  const total = Math.max(1, workdays(w.start, w.end));
  const elapsed = workdays(w.start, today < w.end ? addDays(today, -1) : w.end); // dias completos antes de hoje
  const expected = (target * elapsed) / total;
  const remainingDays = Math.max(0, workdays(today, w.end));
  const pct = target ? actual / target : 0;
  const state = actual >= target ? "batida" : actual + 1e-9 >= expected ? "no_ritmo" : "atras";
  return {
    goal: g, actual, pct, window: w, expected,
    perDayNeeded: actual >= target || !remainingDays ? null : (target - actual) / remainingDays,
    state,
  };
}

// ---------------------------------------------------------------------------
// Daily automática
// ---------------------------------------------------------------------------
export interface DayNumbers {
  visitsDone: number;
  visitsPlanned: number;
  followUpsDone: number;
  noAnswer: number;
  overdueOpen: number;
  proposals: number;
  sales: number;
  mrr: number;
  newLeads: number;
}

export function dayNumbers(s: Snapshot, tz: string, date: string, today: string): DayNumbers {
  const d = (iso: string | null) => (iso ? dateInTz(iso, tz) : null);
  return {
    visitsDone: s.visits.filter((v) => v.status === "realizada" && d(v.completed_at) === date).length,
    visitsPlanned: s.visits.filter((v) => v.status !== "cancelada" && d(v.scheduled_at) === date).length,
    followUpsDone: s.followUps.filter((f) => f.status === "concluido" && d(f.completed_at) === date && !f.notes?.includes("Substituído")).length,
    noAnswer: s.followUps.filter((f) => f.status === "sem_resposta" && d(f.completed_at) === date).length,
    // pendência só faz sentido para hoje (o passado não guarda foto do backlog)
    overdueOpen: date === today ? s.followUps.filter((f) => f.status === "pendente" && f.due_date < today).length : 0,
    proposals: s.opportunities.filter((o) => o.proposal_sent_at === date).length,
    sales: s.opportunities.filter((o) => o.stage === "fechado" && o.closed_at === date).length,
    mrr: s.opportunities.filter((o) => o.stage === "fechado" && o.closed_at === date).reduce((t, o) => t + Number(o.mrr_value), 0),
    newLeads: s.accounts.filter((a) => d(a.created_at) === date).length,
  };
}

/** Atividade por dia (visitas feitas + follow-ups concluídos) para o gráfico de N dias. */
export function activitySeries(s: Snapshot, tz: string, today: string, days: number) {
  const out: { date: string; visits: number; followUps: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const n = dayNumbers(s, tz, date, today);
    out.push({ date, visits: n.visitsDone, followUps: n.followUpsDone + n.noAnswer });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Funil e conversões
// ---------------------------------------------------------------------------
export const FUNNEL_STEPS = [
  { id: "lead", label: "Lead", hint: "Toda a base" },
  { id: "mql", label: "MQL", hint: "Sinal de interesse (morno/quente) ou já avançou" },
  { id: "sql", label: "SQL", hint: "Virou oportunidade real" },
  { id: "cliente", label: "Cliente", hint: "Fechado" },
] as const;

/** Funil cumulativo: quem chegou a SQL também passou por MQL e Lead. Perdidos contam até onde chegaram. */
export function funnel(accounts: EnrichedAccount[], opps: Snapshot["opportunities"]) {
  const hadOpp = new Set(opps.map((o) => o.account_id));
  const reached = (a: EnrichedAccount) => {
    if (a.funnel_stage === "cliente") return 3;
    if (a.funnel_stage === "sql" || hadOpp.has(a.id)) return 2;
    if (a.funnel_stage === "mql" || a.interest_level !== "frio") return 1;
    return 0;
  };
  const counts = [0, 0, 0, 0];
  for (const a of accounts) for (let i = 0; i <= reached(a); i++) counts[i]++;
  return FUNNEL_STEPS.map((st, i) => ({
    ...st,
    count: counts[i],
    conv: i === 0 ? null : counts[i - 1] ? counts[i] / counts[i - 1] : null,
  }));
}

export interface ConvRow {
  key: string;
  won: number;
  lost: number;
  open: number;
  rate: number | null;
  mrr: number;
}

/** Conversão de contas decididas (fechado ÷ fechado+perdido) agrupada por um campo. */
export function conversionBy(accounts: EnrichedAccount[], keyOf: (a: EnrichedAccount) => string | null | undefined): ConvRow[] {
  const m = new Map<string, ConvRow>();
  for (const a of accounts) {
    const k = keyOf(a)?.trim() || "—";
    const r = m.get(k) ?? { key: k, won: 0, lost: 0, open: 0, rate: null, mrr: 0 };
    if (a.status === "fechado") {
      r.won++;
      r.mrr += a.mrr_closed;
    } else if (a.status === "perdido") r.lost++;
    else r.open++;
    m.set(k, r);
  }
  return [...m.values()]
    .map((r) => ({ ...r, rate: r.won + r.lost ? r.won / (r.won + r.lost) : null }))
    .sort((a, b) => b.won + b.lost + b.open - (a.won + a.lost + a.open));
}

export function lossReasons(s: Snapshot, since: string) {
  const m = new Map<string, number>();
  for (const o of s.opportunities)
    if (o.stage === "perdido" && o.loss_category && dateInTz(o.stage_changed_at) >= since) m.set(o.loss_category, (m.get(o.loss_category) ?? 0) + 1);
  for (const a of s.accounts)
    if (a.status === "perdido" && a.loss_reason && !s.opportunities.some((o) => o.account_id === a.id && o.stage === "perdido") && dateInTz(a.updated_at) >= since)
      m.set(a.loss_reason, (m.get(a.loss_reason) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Ciclo médio de venda (dias entre criação da oportunidade e fechamento). */
export function salesCycleDays(s: Snapshot): number | null {
  const won = s.opportunities.filter((o) => o.stage === "fechado" && o.closed_at);
  if (!won.length) return null;
  return won.reduce((t, o) => t + diffDays(o.created_at.slice(0, 10), o.closed_at!), 0) / won.length;
}

export const periodPresets = (today: string) => ({
  diaria: { start_date: today, end_date: addDays(today, 365) },
  semanal: { start_date: weekStart(today), end_date: addDays(weekStart(today), 7 * 52 - 1) },
  mensal: { start_date: monthStart(today), end_date: monthEnd(addDays(monthStart(today), 360)) },
});
