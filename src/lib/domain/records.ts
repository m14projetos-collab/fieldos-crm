// Registros simples (metas, daily, playbooks, oportunidade): upsert/remove no snapshot.
import { DomainError, type Ctx, clone, replace } from "./transitions";
import type { DailyLog, Goal, Opportunity, Playbook, Snapshot } from "./types";

export type GoalInput = Omit<Goal, "org_id"> & { org_id?: string };
export type DailyLogInput = Omit<DailyLog, "org_id" | "created_at" | "owner_id"> & { org_id?: string };
export type PlaybookInput = Omit<Playbook, "org_id" | "updated_at"> & { org_id?: string };
export const UPDATABLE_OPP_FIELDS = ["title", "plan_name", "mrr_value", "expected_close_date", "chave_checklist"] as const;
export type OppPatch = Partial<Pick<Opportunity, (typeof UPDATABLE_OPP_FIELDS)[number]>>;

export function validateGoal(g: GoalInput) {
  if (!g.title.trim()) throw new DomainError("INVALID", "Dê um nome para a meta");
  if (!(g.target_value > 0)) throw new DomainError("INVALID", "A meta precisa ser maior que zero");
  if (g.end_date < g.start_date) throw new DomainError("INVALID", "Data final antes da inicial");
}

export function applySaveGoal(s: Snapshot, g: GoalInput, ctx: Ctx): Snapshot {
  validateGoal(g);
  const row: Goal = { ...g, org_id: ctx.orgId, title: g.title.trim() };
  const exists = s.goals.some((x) => x.id === g.id);
  return { ...s, goals: exists ? replace(s.goals, row) : [...s.goals, row] };
}

export function applyDeleteGoal(s: Snapshot, id: string): Snapshot {
  return { ...s, goals: s.goals.filter((g) => g.id !== id) };
}

export function applySaveDailyLog(s: Snapshot, d: DailyLogInput, ctx: Ctx): Snapshot {
  if (d.day_score != null && (d.day_score < 1 || d.day_score > 10)) throw new DomainError("INVALID", "Nota do dia vai de 1 a 10");
  const existing = s.dailyLogs.find((x) => x.owner_id === ctx.userId && x.log_date === d.log_date);
  const row: DailyLog = {
    ...d, id: existing?.id ?? d.id, org_id: ctx.orgId, owner_id: ctx.userId, created_at: existing?.created_at ?? ctx.now.toISOString(),
  };
  return { ...s, dailyLogs: existing ? replace(s.dailyLogs, row) : [...s.dailyLogs, row] };
}

export function applySavePlaybook(s: Snapshot, p: PlaybookInput, ctx: Ctx): Snapshot {
  if (!p.title.trim() || !p.content_md.trim()) throw new DomainError("INVALID", "Título e conteúdo são obrigatórios");
  const row: Playbook = { ...p, org_id: ctx.orgId, updated_at: ctx.now.toISOString() };
  const exists = s.playbooks.some((x) => x.id === p.id);
  return { ...s, playbooks: exists ? replace(s.playbooks, row) : [...s.playbooks, row] };
}

export function applyDeletePlaybook(s: Snapshot, id: string): Snapshot {
  return { ...s, playbooks: s.playbooks.filter((p) => p.id !== id) };
}

export function pickOpp(patch: OppPatch): OppPatch {
  const out: Record<string, unknown> = {};
  for (const k of UPDATABLE_OPP_FIELDS) if (k in patch) out[k] = patch[k];
  return out as OppPatch;
}

export function applyUpdateOpportunity(s: Snapshot, id: string, patch: OppPatch, ctx: Ctx): Snapshot {
  const o = s.opportunities.find((x) => x.id === id);
  if (!o) throw new DomainError("NOT_FOUND", "Oportunidade não encontrada");
  if (patch.mrr_value != null && patch.mrr_value < 0) throw new DomainError("INVALID", "MRR inválido");
  if (o.stage === "fechado" && patch.mrr_value != null && !(patch.mrr_value > 0))
    throw new DomainError("MRR_REQUIRED", "Venda fechada precisa de MRR");
  const out = clone(s);
  out.opportunities = replace(out.opportunities, { ...o, ...pickOpp(patch), updated_at: ctx.now.toISOString() });
  return out;
}
