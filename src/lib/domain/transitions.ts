// Regras das ações rápidas, em TS puro. Espelham as RPCs do SQL
// (log_visit_outcome, complete_follow_up, create_lead, schedule_visit).
// Usadas no modo demo e como atualização otimista do cache no modo Supabase.
import {
  ACTIVE_STATUSES, OUTCOME_DEFAULTS, STAGE_PROBABILITY, STAGE_RANK, STATUS_RANK, nextCadenceStep,
} from "./constants";
import { addDays, dateInTz } from "./dates";
import type {
  Account, AccountStatus, FollowUp, FollowUpChannel, Interest, OppStage, Opportunity, Snapshot, Visit, VisitOutcome,
  VisitType,
} from "./types";

export class DomainError extends Error {
  constructor(public code: "NEXT_FOLLOWUP_REQUIRED" | "INVALID" | "NOT_FOUND", message: string) {
    super(message);
  }
}

export interface Ctx {
  orgId: string;
  userId: string;
  tz: string;
  now: Date;
  newId: () => string;
}

export interface LogVisitInput {
  visitId: string;
  outcome: VisitOutcome;
  nextInDays?: number | null;
  nextChannel?: FollowUpChannel | null;
  notes?: string | null;
}

export interface CompleteFollowUpInput {
  followUpId: string;
  result: "concluido" | "sem_resposta";
  nextInDays?: number | null;
  nextChannel?: FollowUpChannel | null;
  nextTitle?: string | null;
}

export interface CreateLeadInput {
  name: string;
  whatsapp?: string;
  neighborhood?: string;
  currentSystem?: string;
  segment?: string;
  region?: string;
}

export interface ScheduleVisitInput {
  accountId: string;
  scheduledAt: string; // ISO
  visitType: VisitType;
  durationMinutes?: number;
}

const clone = (s: Snapshot): Snapshot => ({
  accounts: [...s.accounts],
  visits: [...s.visits],
  opportunities: [...s.opportunities],
  followUps: [...s.followUps],
  goals: s.goals,
});

function replace<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.map((r) => (r.id === row.id ? row : r));
}

export function applyLogVisitOutcome(s: Snapshot, input: LogVisitInput, ctx: Ctx): Snapshot {
  const out = clone(s);
  const nowIso = ctx.now.toISOString();
  const today = dateInTz(ctx.now, ctx.tz);
  const visit = out.visits.find((v) => v.id === input.visitId);
  if (!visit) throw new DomainError("NOT_FOUND", "Visita não encontrada");
  if (visit.status === "realizada" || visit.status === "cancelada")
    throw new DomainError("INVALID", `Visita já está ${visit.status}`);
  const acc = out.accounts.find((a) => a.id === visit.account_id);
  if (!acc) throw new DomainError("NOT_FOUND", "Conta não encontrada");

  let status: AccountStatus = acc.status;
  let interest: Interest = acc.interest_level;
  let stage: OppStage | null = null;
  let priority: FollowUp["priority"] = "alta";
  const atLeast = (target: AccountStatus) => {
    if (STATUS_RANK[acc.status] < STATUS_RANK[target]) status = target;
  };

  switch (input.outcome) {
    case "interesse_confirmado":
      atLeast("discovery");
      interest = acc.interest_level === "frio" ? "morno" : "quente";
      stage = "qualificado";
      break;
    case "proposta_solicitada":
      atLeast("demo_realizada");
      interest = "quente";
      stage = "demo_agendada";
      break;
    case "retorno_necessario":
      atLeast("primeiro_contato");
      priority = "media";
      break;
    case "sem_interesse":
      status = "perdido";
      interest = "frio";
      stage = "perdido";
      priority = "baixa";
      break;
    case "fechado":
      status = "fechado";
      stage = "fechado";
      break;
  }
  const def = OUTCOME_DEFAULTS[input.outcome];
  const days = input.nextInDays ?? def.days;
  const channel = input.nextChannel ?? def.channel;
  if (days < 0 || days > 365) throw new DomainError("INVALID", "Prazo do próximo follow-up inválido");

  // 1) visita
  const notes = input.notes?.trim();
  const newVisit: Visit = {
    ...visit, status: "realizada", outcome: input.outcome, completed_at: nowIso,
    checkin_notes: notes || visit.checkin_notes, updated_at: nowIso,
  };
  out.visits = replace(out.visits, newVisit);

  // 2) conta
  const newAcc: Account = {
    ...acc,
    status, interest_level: interest,
    last_interaction_at: nowIso,
    last_channel_used: "visita",
    first_contact_date: acc.first_contact_date ?? today,
    post_sale_phase: status === "fechado" ? acc.post_sale_phase ?? "onboarding" : acc.post_sale_phase,
    loss_reason: status === "perdido" ? acc.loss_reason ?? "sem_interesse_momento" : acc.loss_reason,
    updated_at: nowIso,
  };
  out.accounts = replace(out.accounts, newAcc);

  // 3) pipeline
  let opp: Opportunity | undefined = out.opportunities
    .filter((o) => o.account_id === acc.id && o.stage !== "fechado" && o.stage !== "perdido")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  if (stage === "perdido") {
    out.opportunities = out.opportunities.map((o) =>
      o.account_id === acc.id && o.stage !== "fechado" && o.stage !== "perdido"
        ? { ...o, stage: "perdido", probability: 0, stage_changed_at: nowIso, updated_at: nowIso }
        : o,
    );
    opp = undefined;
  } else if (stage) {
    if (!opp) {
      opp = {
        id: ctx.newId(), org_id: acc.org_id, account_id: acc.id, owner_id: visit.owner_id ?? acc.owner_id,
        title: acc.name, stage, plan_name: null, mrr_value: 0, probability: STAGE_PROBABILITY[stage],
        expected_close_date: null, proposal_sent_at: null, closed_at: stage === "fechado" ? today : null,
        conversion_channel: "visita_presencial", stage_changed_at: nowIso, created_at: nowIso, updated_at: nowIso,
      };
      out.opportunities = [...out.opportunities, opp];
    } else if (STAGE_RANK[stage] > STAGE_RANK[opp.stage]) {
      opp = {
        ...opp, stage, probability: Math.max(opp.probability, STAGE_PROBABILITY[stage]),
        closed_at: stage === "fechado" ? today : opp.closed_at, stage_changed_at: nowIso, updated_at: nowIso,
      };
      out.opportunities = replace(out.opportunities, opp);
    }
  }

  // 4) follow-ups: encerra pendentes e cria UMA próxima ação
  out.followUps = out.followUps.map((f) =>
    f.account_id === acc.id && f.status === "pendente"
      ? { ...f, status: "concluido", completed_at: nowIso }
      : f,
  );
  out.followUps.push({
    id: ctx.newId(), org_id: acc.org_id, account_id: acc.id, visit_id: visit.id,
    opportunity_id: opp?.id ?? null, owner_id: visit.owner_id ?? acc.owner_id,
    title: def.title, due_date: addDays(today, days), status: "pendente", channel, priority,
    cadence_step: null, completed_at: null, notes: null, created_at: nowIso,
  });
  return out;
}

export function applyCompleteFollowUp(s: Snapshot, input: CompleteFollowUpInput, ctx: Ctx): Snapshot {
  const out = clone(s);
  const nowIso = ctx.now.toISOString();
  const today = dateInTz(ctx.now, ctx.tz);
  const fu = out.followUps.find((f) => f.id === input.followUpId);
  if (!fu) throw new DomainError("NOT_FOUND", "Follow-up não encontrado");
  if (fu.status !== "pendente") throw new DomainError("INVALID", "Follow-up já encerrado");
  const acc = out.accounts.find((a) => a.id === fu.account_id);
  if (!acc) throw new DomainError("NOT_FOUND", "Conta não encontrada");

  out.followUps = replace(out.followUps, { ...fu, status: input.result, completed_at: nowIso });

  const promote = input.result === "concluido" && ["novo_lead", "lead_importado", "a_validar", "lead_frio"].includes(acc.status);
  let newAcc: Account = {
    ...acc,
    last_channel_used: fu.channel,
    last_interaction_at: input.result === "concluido" ? nowIso : acc.last_interaction_at,
    first_contact_date: acc.first_contact_date ?? today,
    status: promote ? "primeiro_contato" : acc.status,
    updated_at: nowIso,
  };

  if (input.nextInDays != null) {
    if (input.nextInDays < 0 || input.nextInDays > 365) throw new DomainError("INVALID", "Prazo inválido");
    const step = fu.cadence_step != null ? nextCadenceStep(fu.cadence_step) : null;
    out.followUps.push({
      id: ctx.newId(), org_id: fu.org_id, account_id: fu.account_id, visit_id: null,
      opportunity_id: fu.opportunity_id, owner_id: fu.owner_id,
      title: input.nextTitle?.trim() || (step != null ? `Cadência Dia ${step}` : "Próximo contato"),
      due_date: addDays(today, input.nextInDays), status: "pendente",
      channel: input.nextChannel ?? fu.channel, priority: fu.priority, cadence_step: step,
      completed_at: null, notes: null, created_at: nowIso,
    });
    if (step != null) newAcc = { ...newAcc, cadence_day: step };
  }
  out.accounts = replace(out.accounts, newAcc);

  const hasPending = out.followUps.some((f) => f.account_id === acc.id && f.status === "pendente");
  if (ACTIVE_STATUSES.includes(newAcc.status) && !hasPending) {
    throw new DomainError("NEXT_FOLLOWUP_REQUIRED", "Conta em negociação ativa precisa de um próximo follow-up");
  }
  return out;
}

export function applyCreateLead(s: Snapshot, input: CreateLeadInput, ctx: Ctx, accountId = ctx.newId()): Snapshot {
  const name = input.name.trim();
  if (!name) throw new DomainError("INVALID", "Informe o nome do restaurante");
  const nowIso = ctx.now.toISOString();
  const today = dateInTz(ctx.now, ctx.tz);
  const t = (v?: string) => (v && v.trim() ? v.trim() : null);
  const acc: Account = {
    id: accountId, org_id: ctx.orgId, owner_id: ctx.userId, name, status: "novo_lead",
    phone: null, whatsapp: t(input.whatsapp), email: null, decision_maker_name: null, internal_contact: null,
    persona: "dono_operacional", address: null, city: null, region: t(input.region), neighborhood: t(input.neighborhood),
    latitude: null, longitude: null, segment: t(input.segment), company_size: null, current_system: t(input.currentSystem),
    acquisition_source: null, priority: "media", interest_level: "morno", preferred_channel: "whatsapp",
    last_channel_used: null, first_contact_date: null, last_interaction_at: null, loss_reason: null,
    post_sale_phase: null, cadence_day: 0, pain_inputs: {}, estimated_monthly_pain_brl: null, notes: null,
    created_at: nowIso, updated_at: nowIso,
  };
  const fu: FollowUp = {
    id: ctx.newId(), org_id: ctx.orgId, account_id: acc.id, visit_id: null, opportunity_id: null,
    owner_id: ctx.userId, title: "Cadência Dia 0: primeiro contato", due_date: today, status: "pendente",
    channel: "whatsapp", priority: "alta", cadence_step: 0, completed_at: null, notes: null, created_at: nowIso,
  };
  return { ...s, accounts: [...s.accounts, acc], followUps: [...s.followUps, fu] };
}

export function applyScheduleVisit(s: Snapshot, input: ScheduleVisitInput, ctx: Ctx, visitId = ctx.newId()): Snapshot {
  const acc = s.accounts.find((a) => a.id === input.accountId);
  if (!acc) throw new DomainError("NOT_FOUND", "Conta não encontrada");
  const nowIso = ctx.now.toISOString();
  const visit: Visit = {
    id: visitId, org_id: acc.org_id, account_id: acc.id, route_id: null, route_order: null,
    owner_id: ctx.userId, scheduled_at: input.scheduledAt, duration_minutes: input.durationMinutes ?? 45,
    status: "agendada", visit_type: input.visitType, outcome: null, completed_at: null, checkin_notes: null,
    created_at: nowIso, updated_at: nowIso,
  };
  const fu: FollowUp = {
    id: ctx.newId(), org_id: acc.org_id, account_id: acc.id, visit_id: visit.id, opportunity_id: null,
    owner_id: ctx.userId, title: "Visita agendada", due_date: dateInTz(input.scheduledAt, ctx.tz),
    status: "pendente", channel: "visita", priority: "alta", cadence_step: null, completed_at: null,
    notes: null, created_at: nowIso,
  };
  const status: AccountStatus =
    acc.status === "perdido" || STATUS_RANK[acc.status] < STATUS_RANK.agendado ? "agendado" : acc.status;
  return {
    ...s,
    accounts: replace(s.accounts, { ...acc, status, updated_at: nowIso }),
    visits: [...s.visits, visit],
    followUps: [...s.followUps, fu],
  };
}

export function applyUpdateAccount(s: Snapshot, id: string, patch: Partial<Account>, ctx: Ctx): Snapshot {
  const acc = s.accounts.find((a) => a.id === id);
  if (!acc) throw new DomainError("NOT_FOUND", "Conta não encontrada");
  return { ...s, accounts: replace(s.accounts, { ...acc, ...patch, updated_at: ctx.now.toISOString() }) };
}
