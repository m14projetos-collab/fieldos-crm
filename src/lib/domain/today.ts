// Módulo 1 "Hoje": KPIs, fila de ação e alertas de higiene, calculados dos registros reais.
import { ACTIVE_STATUSES, MISSING_FIELD_LABEL } from "./constants";
import { dateInTz, diffDays, monthStart } from "./dates";
import { type EnrichedAccount, weightedForecast } from "./enrich";
import type { FollowUp, Opportunity, Snapshot, Visit } from "./types";

export interface HygieneAlert {
  kind: "parada" | "sem_proxima_acao" | "incompleta" | "venda_sem_mrr";
  accountId: string;
  text: string;
}

export interface TodayView {
  today: string;
  visitsDoneToday: number;
  visitsPlannedToday: number;
  visitsGoal: number | null;
  fuDueToday: number;
  fuOverdue: number;
  openProposals: number;
  forecast: number;
  mrrMonth: number;
  todayVisits: Visit[];
  nextVisit: Visit | null;
  fuQueue: FollowUp[]; // atrasados primeiro, depois hoje
  alerts: HygieneAlert[];
}

export function computeToday(s: Snapshot, enriched: Map<string, EnrichedAccount>, tz: string, now = new Date()): TodayView {
  const today = dateInTz(now, tz);
  const mStart = monthStart(today);

  const todayVisits = s.visits
    .filter((v) => v.status !== "cancelada" && dateInTz(v.scheduled_at, tz) === today)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const visitsDoneToday = s.visits.filter(
    (v) => v.status === "realizada" && v.completed_at && dateInTz(v.completed_at, tz) === today,
  ).length;
  const pendingToday = todayVisits.filter((v) => v.status === "agendada" || v.status === "em_andamento");
  const nextVisit =
    pendingToday.find((v) => new Date(v.scheduled_at).getTime() >= now.getTime() - 60 * 60_000) ?? pendingToday[0] ?? null;

  const goal = s.goals.find(
    (g) => g.category === "visitas" && g.period_type === "diaria" && g.start_date <= today && g.end_date >= today,
  );

  const pending = s.followUps.filter((f) => f.status === "pendente");
  const overdue = pending.filter((f) => f.due_date < today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const dueToday = pending.filter((f) => f.due_date === today);
  const prio = { alta: 0, media: 1, baixa: 2 } as const;
  dueToday.sort((a, b) => prio[a.priority] - prio[b.priority]);

  const openOpps = s.opportunities.filter((o) => o.stage !== "fechado" && o.stage !== "perdido");
  const proposals = openOpps.filter((o) => o.stage === "proposta_enviada" || o.stage === "negociacao");
  const mrrMonth = s.opportunities
    .filter((o) => o.stage === "fechado" && o.closed_at && o.closed_at >= mStart && o.closed_at <= today)
    .reduce((sum, o) => sum + Number(o.mrr_value), 0);

  return {
    today,
    visitsDoneToday,
    visitsPlannedToday: todayVisits.length,
    visitsGoal: goal ? Number(goal.target_value) : null,
    fuDueToday: dueToday.length,
    fuOverdue: overdue.length,
    openProposals: proposals.length,
    forecast: weightedForecast(openOpps),
    mrrMonth,
    todayVisits,
    nextVisit,
    fuQueue: [...overdue, ...dueToday],
    alerts: hygieneAlerts(s.opportunities, enriched, today, tz),
  };
}

export function hygieneAlerts(
  opps: Opportunity[],
  enriched: Map<string, EnrichedAccount>,
  today: string,
  tz: string,
): HygieneAlert[] {
  const alerts: HygieneAlert[] = [];
  for (const o of opps) {
    const acc = enriched.get(o.account_id);
    if (!acc) continue;
    if (o.stage === "proposta_enviada" || o.stage === "negociacao") {
      const idle = diffDays(dateInTz(o.updated_at, tz), today);
      if (idle > 7) alerts.push({ kind: "parada", accountId: acc.id, text: `${acc.name}: negociação parada há ${idle} dias` });
    }
    if (o.stage === "fechado" && Number(o.mrr_value) <= 0)
      alerts.push({ kind: "venda_sem_mrr", accountId: acc.id, text: `${acc.name}: venda fechada sem MRR preenchido` });
  }
  for (const a of enriched.values()) {
    if (ACTIVE_STATUSES.includes(a.status) && !a.next_followup) {
      alerts.push({ kind: "sem_proxima_acao", accountId: a.id, text: `${a.name}: em negociação sem próxima ação` });
    } else if (a.missing_field && a.missing_field !== "follow_up" && a.status !== "perdido") {
      alerts.push({
        kind: "incompleta", accountId: a.id,
        text: `${a.name}: falta ${MISSING_FIELD_LABEL[a.missing_field] ?? a.missing_field}`,
      });
    }
  }
  const order = { sem_proxima_acao: 0, parada: 1, venda_sem_mrr: 2, incompleta: 3 } as const;
  return alerts.sort((x, y) => order[x.kind] - order[y.kind]);
}
