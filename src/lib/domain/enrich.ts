// Fórmulas nativas (espelho de vw_accounts_enriched no SQL). Testadas em enrich.test.ts.
import type { Account, FollowUp, Opportunity, Snapshot, Visit } from "./types";

export interface EnrichedAccount extends Account {
  visits_done: number;
  followups_total: number;
  next_followup: FollowUp | null;
  opps_active: number;
  mrr_open: number;
  mrr_closed: number;
  commercial_score: number;
  next_best_action: string;
  missing_field: string | null;
  funnel_stage: "lead" | "mql" | "sql" | "cliente" | "perdido";
  /** até onde a conta chegou no funil (0 lead, 1 MQL, 2 SQL, 3 cliente); perdidos contam até onde chegaram */
  funnel_reach: 0 | 1 | 2 | 3;
}

/** Status de prospecção sem contato feito: "morno" vindo da importação não é sinal real de interesse. */
export const UNTOUCHED_STATUSES: Account["status"][] = ["lead_frio", "novo_lead", "lead_importado", "a_validar"];
const SQL_STATUSES: Account["status"][] = ["agendado", "demo_realizada", "proposta_enviada", "negociacao"];
const SQL_STAGES: Opportunity["stage"][] = ["qualificado", "demo_agendada", "proposta_enviada", "negociacao", "fechado", "perdido"];
export const MQL_MIN_SCORE = 40;
const FUNNEL_BY_REACH = ["lead", "mql", "sql", "cliente"] as const;

/**
 * Regra do funil B2B:
 * Cliente = fechado. SQL = oportunidade qualificada (Qualificado, Demo/Visita, Proposta, Negociação) ou conta nesses status.
 * MQL = quente, score ≥ 40, ou morno com contato já feito. Lead = o resto.
 */
export function funnelReach(
  a: Pick<Account, "status" | "interest_level">,
  opps: Pick<Opportunity, "stage">[],
  score: number,
): 0 | 1 | 2 | 3 {
  if (a.status === "fechado" || opps.some((o) => o.stage === "fechado")) return 3;
  if (SQL_STATUSES.includes(a.status) || opps.some((o) => SQL_STAGES.includes(o.stage))) return 2;
  if (a.interest_level === "quente" || score >= MQL_MIN_SCORE) return 1;
  if (a.interest_level === "morno" && !UNTOUCHED_STATUSES.includes(a.status)) return 1;
  return 0;
}

const DAY_MS = 86_400_000;

export function inactivityPenalty(lastInteractionAt: string | null, now: Date): number {
  if (!lastInteractionAt) return 10;
  const days = (now.getTime() - new Date(lastInteractionAt).getTime()) / DAY_MS;
  if (days > 30) return 15;
  if (days > 15) return 8;
  return 0;
}

export function commercialScore(
  a: Pick<Account, "priority" | "interest_level" | "status" | "last_interaction_at">,
  visitsDone: number,
  followupsTotal: number,
  oppsActive: number,
  now: Date,
): number {
  const p = a.priority === "alta" ? 20 : a.priority === "media" ? 12 : 6;
  const i = a.interest_level === "quente" ? 25 : a.interest_level === "morno" ? 15 : 5;
  const s =
    a.status === "negociacao" ? 20
    : a.status === "proposta_enviada" ? 18
    : a.status === "demo_realizada" ? 15
    : a.status === "discovery" ? 10
    : 5;
  const raw =
    p + i + s +
    Math.min(visitsDone * 5, 15) +
    Math.min(followupsTotal * 3, 12) +
    (oppsActive > 0 ? 8 : 0) -
    inactivityPenalty(a.last_interaction_at, now);
  return Math.min(100, Math.max(0, raw));
}

export function nextBestAction(a: Pick<Account, "status" | "loss_reason" | "interest_level" | "preferred_channel">): string {
  if (a.status === "perdido") return "recuperar_oportunidade";
  if (a.loss_reason === "contato_invalido") return "encerrar_negociacao";
  if (a.status === "fechado") return "pos_venda_indicacao";
  if (a.interest_level === "quente") return "ligar_agora";
  if (a.status === "proposta_enviada") return "cobrar_decisao";
  if (a.status === "negociacao") return "enviar_proposta_final";
  if (a.preferred_channel === "visita") return "fazer_visita";
  if (a.preferred_channel === "whatsapp") return "enviar_whatsapp";
  if (a.status === "novo_lead") return "ligar_conexao";
  if (a.status === "lead_importado") return "whatsapp_dia_0";
  return "ligar";
}

const blank = (v: string | null | undefined) => !v || v.trim() === "";

export function missingField(a: Account, nextFollowup: FollowUp | null): string | null {
  if (blank(a.phone) && blank(a.whatsapp)) return "telefone";
  if (blank(a.region)) return "regiao";
  if (blank(a.neighborhood)) return "bairro";
  if (!nextFollowup && a.status !== "fechado" && a.status !== "perdido") return "follow_up";
  return null;
}

function pickNext(fus: FollowUp[]): FollowUp | null {
  const pending = fus.filter((f) => f.status === "pendente");
  if (!pending.length) return null;
  return pending.sort((x, y) => x.due_date.localeCompare(y.due_date) || x.created_at.localeCompare(y.created_at))[0];
}

export function enrichAccount(
  a: Account,
  visits: Visit[],
  opps: Opportunity[],
  fus: FollowUp[],
  now: Date = new Date(),
): EnrichedAccount {
  const visitsDone = visits.filter((v) => v.status === "realizada").length;
  const next = pickNext(fus);
  const oppsActive = opps.filter((o) => o.stage !== "perdido").length;
  const mrrOpen = opps.filter((o) => o.stage !== "perdido" && o.stage !== "fechado").reduce((s, o) => s + Number(o.mrr_value), 0);
  const mrrClosed = opps.filter((o) => o.stage === "fechado").reduce((s, o) => s + Number(o.mrr_value), 0);
  const score = commercialScore(a, visitsDone, fus.length, oppsActive, now);
  const reach = funnelReach(a, opps, score);
  const funnel: EnrichedAccount["funnel_stage"] = a.status === "perdido" ? "perdido" : FUNNEL_BY_REACH[reach];

  return {
    ...a,
    visits_done: visitsDone,
    followups_total: fus.length,
    next_followup: next,
    opps_active: oppsActive,
    mrr_open: mrrOpen,
    mrr_closed: mrrClosed,
    commercial_score: score,
    funnel_reach: reach,
    next_best_action: nextBestAction(a),
    missing_field: missingField(a, next),
    funnel_stage: funnel,
  };
}

/** Indexa o snapshot por conta e enriquece todas (O(n)). */
export function enrichAll(s: Snapshot, now: Date = new Date()): Map<string, EnrichedAccount> {
  const by = <T extends { account_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const arr = m.get(r.account_id);
      if (arr) arr.push(r);
      else m.set(r.account_id, [r]);
    }
    return m;
  };
  const v = by(s.visits);
  const o = by(s.opportunities);
  const f = by(s.followUps);
  const out = new Map<string, EnrichedAccount>();
  for (const a of s.accounts) {
    out.set(a.id, enrichAccount(a, v.get(a.id) ?? [], o.get(a.id) ?? [], f.get(a.id) ?? [], now));
  }
  return out;
}

export const weightedForecast = (opps: Opportunity[]) =>
  opps
    .filter((o) => o.stage !== "perdido" && o.stage !== "fechado")
    .reduce((s, o) => s + Number(o.mrr_value) * (o.probability / 100), 0);
