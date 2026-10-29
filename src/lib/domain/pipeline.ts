// Pipeline, status da conta, visitas e rotas em TS puro.
// Espelha as RPCs da migration 0009 (move_opportunity, create_opportunity, set_account_status,
// cancel_visit, reschedule_visit, save_route, set_route_status). Usado no modo demo e na UI otimista.
import { ACTIVE_STATUSES, STAGE_PROBABILITY, STATUS_RANK } from "./constants";
import { addDays, dateInTz } from "./dates";
import { type Ctx, DomainError, clone, replace } from "./transitions";
import type {
  Account, AccountStatus, FollowUp, FollowUpChannel, OppStage, Opportunity, Priority, Route, RouteStatus, Snapshot,
} from "./types";

export const LOSS_CATEGORIES: { value: string; label: string }[] = [
  { value: "preco", label: "Preço / achou caro" },
  { value: "ja_tem_sistema", label: "Já tem sistema e não quer trocar" },
  { value: "concorrente", label: "Fechou com concorrente" },
  { value: "sem_interesse_momento", label: "Sem interesse no momento" },
  { value: "sem_decisor", label: "Não chegou ao decisor" },
  { value: "timing", label: "Momento ruim (obra, troca de sócio, sazonalidade)" },
  { value: "contato_invalido", label: "Contato inválido / fechou as portas" },
  { value: "outro", label: "Outro" },
];
export const lossLabel = (v: string | null | undefined) => LOSS_CATEGORIES.find((c) => c.value === v)?.label ?? v ?? "";

const isOpen = (o: Opportunity) => o.stage !== "fechado" && o.stage !== "perdido";

function newFu(acc: Account, ctx: Ctx, oppId: string | null, title: string, due: string, channel: FollowUpChannel, priority: Priority): FollowUp {
  return {
    id: ctx.newId(), org_id: acc.org_id, account_id: acc.id, visit_id: null, opportunity_id: oppId,
    owner_id: ctx.userId || acc.owner_id, title, due_date: due, status: "pendente", channel, priority,
    cadence_step: null, completed_at: null, notes: null, created_at: ctx.now.toISOString(),
  };
}

/** fu_set_next: cancela as pendentes da conta e cria UMA nova. */
function fuSetNext(s: Snapshot, acc: Account, ctx: Ctx, oppId: string | null, title: string, due: string,
  channel: FollowUpChannel, priority: Priority, reason: string) {
  const nowIso = ctx.now.toISOString();
  s.followUps = s.followUps.map((f) =>
    f.account_id === acc.id && f.status === "pendente"
      ? { ...f, status: "cancelado", completed_at: nowIso, notes: (f.notes ? f.notes + "\n" : "") + "Substituído: " + reason }
      : f,
  );
  s.followUps.push(newFu(acc, ctx, oppId, title, due, channel, priority));
}

/** fu_ensure_next: só cria se a conta está ativa e não tem nenhuma pendente. */
function fuEnsureNext(s: Snapshot, accId: string, ctx: Ctx, oppId: string | null, title: string, due: string, channel: FollowUpChannel) {
  const acc = s.accounts.find((a) => a.id === accId)!;
  if (ACTIVE_STATUSES.includes(acc.status) && !s.followUps.some((f) => f.account_id === accId && f.status === "pendente"))
    s.followUps.push(newFu(acc, ctx, oppId, title, due, channel, "alta"));
}

export interface MoveOpportunityInput {
  oppId: string;
  stage: OppStage;
  mrr?: number | null;
  lossCategory?: string | null;
  lossDetail?: string | null;
}

const STAGE_TO_STATUS: Record<Exclude<OppStage, "fechado" | "perdido">, AccountStatus> = {
  negociacao: "negociacao", proposta_enviada: "proposta_enviada", demo_agendada: "demo_realizada",
  qualificado: "discovery", lead: "primeiro_contato",
};

function moveInPlace(out: Snapshot, input: MoveOpportunityInput, ctx: Ctx) {
  const nowIso = ctx.now.toISOString();
  const today = dateInTz(ctx.now, ctx.tz);
  const opp0 = out.opportunities.find((o) => o.id === input.oppId);
  if (!opp0) throw new DomainError("NOT_FOUND", "Oportunidade não encontrada");
  const acc = out.accounts.find((a) => a.id === opp0.account_id);
  if (!acc) throw new DomainError("NOT_FOUND", "Conta não encontrada");
  const mrr = input.mrr ?? opp0.mrr_value;
  if (mrr < 0) throw new DomainError("INVALID", "MRR inválido");
  const stage = input.stage;
  if (stage === "fechado" && !(mrr > 0)) throw new DomainError("MRR_REQUIRED", "Informe o MRR (valor mensal) para fechar a venda");
  const loss = input.lossCategory?.trim() || "";
  if (stage === "perdido" && !loss) throw new DomainError("LOSS_REASON_REQUIRED", "Informe o motivo da perda");

  const opp: Opportunity = {
    ...opp0,
    stage, mrr_value: mrr, probability: STAGE_PROBABILITY[stage],
    proposal_sent_at: ["proposta_enviada", "negociacao", "fechado"].includes(stage)
      ? opp0.proposal_sent_at ?? (stage === "proposta_enviada" ? today : null)
      : opp0.proposal_sent_at,
    closed_at: stage === "fechado" ? opp0.closed_at ?? today : null,
    loss_category: stage === "perdido" ? loss : null,
    loss_detail: stage === "perdido" ? input.lossDetail?.trim() || null : null,
    stage_changed_at: stage !== opp0.stage ? nowIso : opp0.stage_changed_at,
    updated_at: nowIso,
  };
  out.opportunities = replace(out.opportunities, opp);

  let status: AccountStatus;
  if (stage === "fechado") status = "fechado";
  else if (stage === "perdido")
    status = out.opportunities.some((o) => o.account_id === acc.id && o.id !== opp.id && isOpen(o)) ? acc.status : "perdido";
  else {
    status = STAGE_TO_STATUS[stage];
    if (acc.status !== "perdido" && acc.status !== "fechado" && STATUS_RANK[status] < STATUS_RANK[acc.status]) status = acc.status;
  }
  if (acc.status === "fechado") status = "fechado";

  out.accounts = replace(out.accounts, {
    ...acc, status,
    interest_level: ["proposta_enviada", "negociacao", "fechado"].includes(stage) ? "quente" : acc.interest_level,
    post_sale_phase: status === "fechado" ? acc.post_sale_phase ?? "onboarding" : acc.post_sale_phase,
    loss_reason: status === "perdido" ? loss : acc.loss_reason,
    updated_at: nowIso,
  });
  const a = out.accounts.find((x) => x.id === acc.id)!;

  switch (stage) {
    case "proposta_enviada":
      fuSetNext(out, a, ctx, opp.id, 'Cobrar decisão da proposta (Virada: perguntar "como", não "se")', addDays(today, 2), "whatsapp", "alta", "proposta enviada");
      break;
    case "negociacao":
      fuSetNext(out, a, ctx, opp.id, "Negociação: alinhar condições e data de início", addDays(today, 2), "ligacao", "alta", "negociação");
      break;
    case "fechado":
      fuSetNext(out, a, ctx, opp.id, "Pós-venda 7 dias: confirmar resultado e pedir indicação", addDays(today, 7), "visita", "alta", "venda fechada");
      break;
    case "perdido":
      if (status === "perdido")
        fuSetNext(out, a, ctx, null, `Recuperação: nova abordagem (motivo: ${loss})`, addDays(today, 90), "whatsapp", "baixa", "oportunidade perdida");
      break;
    case "demo_agendada":
      fuEnsureNext(out, a.id, ctx, opp.id, "Confirmar demonstração", addDays(today, 1), "whatsapp");
      break;
    default:
      fuEnsureNext(out, a.id, ctx, opp.id, "Próximo contato da oportunidade", addDays(today, 2), "whatsapp");
  }
  return opp.id;
}

export function applyMoveOpportunity(s: Snapshot, input: MoveOpportunityInput, ctx: Ctx): Snapshot {
  const out = clone(s);
  moveInPlace(out, input, ctx);
  return out;
}

export interface CreateOpportunityInput {
  id: string;
  accountId: string;
  stage?: OppStage;
  mrr?: number | null;
  planName?: string | null;
  title?: string | null;
}

function createInPlace(out: Snapshot, input: CreateOpportunityInput, ctx: Ctx) {
  const stage = input.stage ?? "qualificado";
  if (stage === "fechado" || stage === "perdido") throw new DomainError("INVALID", "Crie a oportunidade numa etapa aberta e depois mova");
  const acc = out.accounts.find((a) => a.id === input.accountId);
  if (!acc) throw new DomainError("NOT_FOUND", "Conta não encontrada");
  if (out.opportunities.some((o) => o.account_id === acc.id && isOpen(o)))
    throw new DomainError("OPEN_OPP_EXISTS", "Esta conta já tem uma oportunidade aberta");
  const nowIso = ctx.now.toISOString();
  out.opportunities.push({
    id: input.id, org_id: acc.org_id, account_id: acc.id, owner_id: ctx.userId || acc.owner_id,
    title: input.title?.trim() || acc.name, stage: "lead", plan_name: input.planName?.trim() || null,
    mrr_value: Math.max(input.mrr ?? 0, 0), probability: STAGE_PROBABILITY.lead, expected_close_date: null,
    proposal_sent_at: null, closed_at: null, conversion_channel: acc.last_channel_used ?? "prospeccao_ativa",
    loss_category: null, loss_detail: null, chave_checklist: {}, stage_changed_at: nowIso, created_at: nowIso, updated_at: nowIso,
  });
  moveInPlace(out, { oppId: input.id, stage }, ctx);
  return input.id;
}

export function applyCreateOpportunity(s: Snapshot, input: CreateOpportunityInput, ctx: Ctx): Snapshot {
  const out = clone(s);
  createInPlace(out, input, ctx);
  return out;
}

export interface SetAccountStatusInput {
  accountId: string;
  status: AccountStatus;
  mrr?: number | null;
  lossCategory?: string | null;
  /** id da oportunidade criada, se precisar (mantém o mesmo id no servidor e no cache) */
  newOppId?: string;
}

const STATUS_TO_STAGE: Partial<Record<AccountStatus, OppStage>> = {
  demo_realizada: "demo_agendada", proposta_enviada: "proposta_enviada", negociacao: "negociacao", fechado: "fechado",
};

export function applySetAccountStatus(s: Snapshot, input: SetAccountStatusInput, ctx: Ctx): Snapshot {
  const out = clone(s);
  const acc = out.accounts.find((a) => a.id === input.accountId);
  if (!acc) throw new DomainError("NOT_FOUND", "Conta não encontrada");
  const today = dateInTz(ctx.now, ctx.tz);
  const nowIso = ctx.now.toISOString();
  const opp = out.opportunities
    .filter((o) => o.account_id === acc.id && isOpen(o))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const stage = STATUS_TO_STAGE[input.status];

  if (stage) {
    let oppId = opp?.id;
    if (!oppId)
      oppId = createInPlace(out, {
        id: input.newOppId ?? ctx.newId(), accountId: acc.id,
        stage: input.status === "fechado" ? "negociacao" : stage, mrr: input.mrr,
      }, ctx);
    moveInPlace(out, { oppId, stage, mrr: input.mrr }, ctx);
    const a = out.accounts.find((x) => x.id === acc.id)!;
    out.accounts = replace(out.accounts, { ...a, status: input.status, updated_at: nowIso });
    return out;
  }

  if (input.status === "perdido") {
    const loss = input.lossCategory?.trim();
    if (!loss) throw new DomainError("LOSS_REASON_REQUIRED", "Informe o motivo da perda");
    out.opportunities = out.opportunities.map((o) =>
      o.account_id === acc.id && isOpen(o)
        ? { ...o, stage: "perdido", probability: 0, closed_at: null, loss_category: loss, stage_changed_at: nowIso, updated_at: nowIso }
        : o,
    );
    const a = { ...acc, status: "perdido" as const, loss_reason: loss, updated_at: nowIso };
    out.accounts = replace(out.accounts, a);
    fuSetNext(out, a, ctx, null, `Recuperação: nova abordagem (motivo: ${loss})`, addDays(today, 90), "whatsapp", "baixa", "conta perdida");
    return out;
  }

  if (opp)
    throw new DomainError("OPEN_OPP_EXISTS", "Esta conta tem uma oportunidade aberta no pipeline: mova por lá ou marque como perdida");
  out.accounts = replace(out.accounts, {
    ...acc, status: input.status, loss_reason: acc.status === "perdido" ? null : acc.loss_reason, updated_at: nowIso,
  });
  const st = input.status;
  fuEnsureNext(out, acc.id, ctx, null,
    st === "agendado" ? "Agendar a visita combinada" : st === "discovery" ? "Diagnóstico: 3 perguntas da Hipótese" : "Próximo contato",
    addDays(today, st === "agendado" ? 1 : 2),
    st === "agendado" ? "visita" : st === "discovery" ? "ligacao" : "whatsapp");
  return out;
}

export interface CancelVisitInput { visitId: string; reason?: string | null }
export interface RescheduleVisitInput { visitId: string; scheduledAt: string }

export function applyCancelVisit(s: Snapshot, input: CancelVisitInput, ctx: Ctx): Snapshot {
  const out = clone(s);
  const v = out.visits.find((x) => x.id === input.visitId);
  if (!v) throw new DomainError("NOT_FOUND", "Visita não encontrada");
  if (v.status === "realizada" || v.status === "cancelada") throw new DomainError("INVALID", `Visita já está ${v.status}`);
  const nowIso = ctx.now.toISOString();
  out.visits = replace(out.visits, {
    ...v, status: "cancelada", route_id: null, route_order: null, checkin_notes: input.reason?.trim() || v.checkin_notes, updated_at: nowIso,
  });
  out.followUps = out.followUps.map((f) =>
    f.visit_id === v.id && f.status === "pendente"
      ? { ...f, status: "cancelado", completed_at: nowIso, notes: (f.notes ? f.notes + "\n" : "") + "Visita cancelada" }
      : f,
  );
  fuEnsureNext(out, v.account_id, ctx, null, "Reagendar visita cancelada", addDays(dateInTz(ctx.now, ctx.tz), 1), "whatsapp");
  return out;
}

export function applyRescheduleVisit(s: Snapshot, input: RescheduleVisitInput, ctx: Ctx): Snapshot {
  const out = clone(s);
  const v = out.visits.find((x) => x.id === input.visitId);
  if (!v) throw new DomainError("NOT_FOUND", "Visita não encontrada");
  if (v.status !== "agendada" && v.status !== "reagendada") throw new DomainError("INVALID", "Só visitas agendadas podem ser reagendadas");
  const sameDay = dateInTz(input.scheduledAt, ctx.tz) === dateInTz(v.scheduled_at, ctx.tz);
  out.visits = replace(out.visits, {
    ...v, scheduled_at: input.scheduledAt, route_id: sameDay ? v.route_id : null, route_order: sameDay ? v.route_order : null,
    updated_at: ctx.now.toISOString(),
  });
  const due = dateInTz(input.scheduledAt, ctx.tz);
  out.followUps = out.followUps.map((f) => (f.visit_id === v.id && f.status === "pendente" ? { ...f, due_date: due } : f));
  return out;
}

export interface SaveRouteInput {
  id: string; // usado só se a rota do dia ainda não existe
  routeDate: string;
  visitIds: string[];
  km: number;
  minutes: number;
  source: "ruas" | "linha_reta";
  startTime?: string | null;
  times?: string[] | null;
  shift?: Route["shift"];
  notes?: string | null;
}

const OPEN_VISIT = ["agendada", "em_andamento", "reagendada"];

export function applySaveRoute(s: Snapshot, input: SaveRouteInput, ctx: Ctx): Snapshot {
  const out = clone(s);
  if (input.source !== "ruas" && input.source !== "linha_reta") throw new DomainError("INVALID", "Origem da distância inválida");
  if (input.times && input.times.length !== input.visitIds.length) throw new DomainError("INVALID", "Horários e visitas com tamanhos diferentes");
  for (const id of input.visitIds) {
    const v = out.visits.find((x) => x.id === id);
    if (!v || !OPEN_VISIT.includes(v.status) || dateInTz(v.scheduled_at, ctx.tz) !== input.routeDate)
      throw new DomainError("INVALID", "Há visitas fora do dia ou já encerradas na rota");
  }
  const nowIso = ctx.now.toISOString();
  let route = out.routes.find((r) => r.owner_id === ctx.userId && r.route_date === input.routeDate && r.status !== "cancelada");
  const km = Math.round(input.km * 10) / 10;
  if (!route) {
    route = {
      id: input.id, org_id: ctx.orgId, owner_id: ctx.userId, route_date: input.routeDate, shift: input.shift ?? "dia_todo",
      work_mode: "campo", status: "planejada", estimated_km: km, estimated_minutes: input.minutes, distance_source: input.source,
      start_time: input.startTime ?? null, logistics_notes: input.notes?.trim() || null, created_at: nowIso,
    };
    out.routes.push(route);
  } else {
    route = {
      ...route, estimated_km: km, estimated_minutes: input.minutes, distance_source: input.source,
      start_time: input.startTime ?? route.start_time, shift: input.shift ?? "dia_todo",
      logistics_notes: input.notes?.trim() || route.logistics_notes,
    };
    out.routes = replace(out.routes, route);
  }
  const rid = route.id;
  out.visits = out.visits.map((v) => {
    const i = input.visitIds.indexOf(v.id);
    if (i >= 0) return { ...v, route_id: rid, route_order: i + 1, scheduled_at: input.times ? input.times[i] : v.scheduled_at, updated_at: nowIso };
    if (v.route_id === rid) return { ...v, route_id: null, route_order: null, updated_at: nowIso };
    return v;
  });
  return out;
}

export function applySetRouteStatus(s: Snapshot, input: { routeId: string; status: RouteStatus }): Snapshot {
  const out = clone(s);
  const r = out.routes.find((x) => x.id === input.routeId);
  if (!r) throw new DomainError("NOT_FOUND", "Rota não encontrada");
  out.routes = replace(out.routes, { ...r, status: input.status });
  if (input.status === "cancelada")
    out.visits = out.visits.map((v) => (v.route_id === r.id ? { ...v, route_id: null, route_order: null } : v));
  return out;
}

/** Rota do dia do usuário (a mesma que save_route atualiza). */
export function routeFor(s: Snapshot, userId: string, date: string): Route | undefined {
  return s.routes.find((r) => r.owner_id === userId && r.route_date === date && r.status !== "cancelada");
}
