// Modo Supabase: leituras com RLS + ações rápidas via RPC atômica (regras no banco).
import type { OrgSettings } from "@/lib/domain/integrations";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Account, DailyLog, FollowUp, Goal, Opportunity, Playbook, Route, Session, Snapshot, Visit,
} from "@/lib/domain/types";
import { pickOpp } from "@/lib/domain/records";
import { DomainError } from "@/lib/domain/transitions";
import { type Repo, pickUpdatable } from "./repo";

const omit = <T extends object>(o: T, keys: string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const PAGE = 1000; // limite padrão de linhas por requisição no Supabase

async function fetchAll<T>(sb: SupabaseClient, table: string, columns = "*"): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(columns).order("id").range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}

function mapError(e: { message?: string; hint?: string; code?: string } | null): never | void {
  if (!e) return;
  for (const h of ["NEXT_FOLLOWUP_REQUIRED", "MRR_REQUIRED", "LOSS_REASON_REQUIRED", "OPEN_OPP_EXISTS"] as const)
    if (e.hint === h) throw new DomainError(h, e.message ?? "");
  if (e.code === "23505") throw new DomainError("INVALID", "Registro duplicado: já existe um igual");
  if (e.code === "P0002") throw new DomainError("NOT_FOUND", e.message ?? "Não encontrado");
  if (e.code === "22023") throw new DomainError("INVALID", e.message ?? "Inválido");
  throw new Error(e.message ?? "Erro no Supabase");
}

export class SupabaseRepo implements Repo {
  constructor(private sb: SupabaseClient, public session: Session) {}

  async load(): Promise<Snapshot> {
    const [accounts, visits, opportunities, followUps, goals, routes, dailyLogs, playbooks] = await Promise.all([
      fetchAll<Account>(this.sb, "accounts"),
      fetchAll<Visit>(this.sb, "visits"),
      fetchAll<Opportunity>(this.sb, "opportunities"),
      fetchAll<FollowUp>(this.sb, "follow_ups"),
      fetchAll<Goal>(this.sb, "goals"),
      fetchAll<Route>(this.sb, "routes"),
      fetchAll<DailyLog>(this.sb, "daily_logs"),
      fetchAll<Playbook>(this.sb, "playbooks"),
    ]);
    const num = <T extends object>(rows: T[], keys: (keyof T)[]) =>
      rows.map((r) => {
        const o = { ...r };
        for (const k of keys) if (o[k] != null) (o[k] as unknown) = Number(o[k]);
        return o;
      });
    return {
      accounts: num(accounts, ["estimated_monthly_pain_brl", "latitude", "longitude"]),
      visits,
      opportunities: num(opportunities, ["mrr_value"]),
      followUps,
      goals: num(goals, ["target_value"]),
      routes: num(routes, ["estimated_km"]),
      dailyLogs,
      playbooks,
    };
  }

  async logVisitOutcome(i: Parameters<Repo["logVisitOutcome"]>[0]) {
    const { error } = await this.sb.rpc("log_visit_outcome", {
      p_visit_id: i.visitId, p_outcome: i.outcome, p_next_in_days: i.nextInDays ?? null,
      p_next_channel: i.nextChannel ?? null, p_notes: i.notes ?? null,
    });
    mapError(error);
  }

  async completeFollowUp(i: Parameters<Repo["completeFollowUp"]>[0]) {
    const { error } = await this.sb.rpc("complete_follow_up", {
      p_follow_up_id: i.followUpId, p_result: i.result, p_next_in_days: i.nextInDays ?? null,
      p_next_channel: i.nextChannel ?? null, p_next_title: i.nextTitle ?? null,
    });
    mapError(error);
  }

  async createLead(i: Parameters<Repo["createLead"]>[0]) {
    const { data, error } = await this.sb.rpc("create_lead", {
      p_name: i.name, p_whatsapp: i.whatsapp ?? null, p_neighborhood: i.neighborhood ?? null,
      p_current_system: i.currentSystem ?? null, p_segment: i.segment ?? null, p_region: i.region ?? null, p_id: i.id,
    });
    mapError(error);
    if (typeof data !== "string" || !/^[0-9a-f]{64}$/.test(data)) throw new Error("O banco não devolveu o link. A atualização da agenda (SQL 0012) já foi aplicada?");
    return data;
  }

  async scheduleVisit(i: Parameters<Repo["scheduleVisit"]>[0]) {
    const { data, error } = await this.sb.rpc("schedule_visit", {
      p_account_id: i.accountId, p_scheduled_at: i.scheduledAt, p_visit_type: i.visitType,
      p_duration: i.durationMinutes ?? 45, p_id: i.id,
    });
    mapError(error);
    if (typeof data !== "string" || !/^[0-9a-f]{64}$/.test(data)) throw new Error("O banco não devolveu o link. A atualização da agenda (SQL 0012) já foi aplicada?");
    return data;
  }

  async updateAccount(id: string, patch: Partial<Account>) {
    const { error } = await this.sb.from("accounts").update(pickUpdatable(patch)).eq("id", id);
    mapError(error);
  }

  private async rpc(fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.sb.rpc(fn, args);
    mapError(error);
    return data as unknown;
  }

  async moveOpportunity(i: Parameters<Repo["moveOpportunity"]>[0]) {
    await this.rpc("move_opportunity", {
      p_opp_id: i.oppId, p_stage: i.stage, p_mrr: i.mrr ?? null, p_loss_category: i.lossCategory ?? null,
      p_loss_detail: i.lossDetail ?? null,
    });
  }
  async createOpportunity(i: Parameters<Repo["createOpportunity"]>[0]) {
    return (await this.rpc("create_opportunity", {
      p_account_id: i.accountId, p_stage: i.stage ?? "qualificado", p_mrr: i.mrr ?? 0, p_plan_name: i.planName ?? null,
      p_title: i.title ?? null, p_id: i.id,
    })) as string;
  }
  async setAccountStatus(i: Parameters<Repo["setAccountStatus"]>[0]) {
    await this.rpc("set_account_status", {
      p_account_id: i.accountId, p_status: i.status, p_mrr: i.mrr ?? null, p_loss_category: i.lossCategory ?? null,
    });
  }
  async updateOpportunity(id: string, patch: Parameters<Repo["updateOpportunity"]>[1]) {
    const { error } = await this.sb.from("opportunities").update(pickOpp(patch)).eq("id", id);
    mapError(error);
  }
  async cancelVisit(i: Parameters<Repo["cancelVisit"]>[0]) {
    await this.rpc("cancel_visit", { p_visit_id: i.visitId, p_reason: i.reason ?? null });
  }
  async rescheduleVisit(i: Parameters<Repo["rescheduleVisit"]>[0]) {
    await this.rpc("reschedule_visit", { p_visit_id: i.visitId, p_scheduled_at: i.scheduledAt });
  }
  async saveRoute(i: Parameters<Repo["saveRoute"]>[0]) {
    return (await this.rpc("save_route", {
      p_route_date: i.routeDate, p_visit_ids: i.visitIds, p_km: i.km, p_minutes: Math.round(i.minutes),
      p_source: i.source, p_start_time: i.startTime ?? null, p_times: i.times ?? null, p_shift: i.shift ?? "dia_todo",
      p_notes: i.notes ?? null,
    })) as string;
  }
  async setRouteStatus(i: Parameters<Repo["setRouteStatus"]>[0]) {
    await this.rpc("set_route_status", { p_route_id: i.routeId, p_status: i.status });
  }
  async saveGoal(g: Parameters<Repo["saveGoal"]>[0]) {
    const { error } = await this.sb.from("goals").upsert(omit(g, ["org_id"]));
    mapError(error);
  }
  async deleteGoal(id: string) {
    const { error } = await this.sb.from("goals").delete().eq("id", id);
    mapError(error);
  }
  async saveDailyLog(d: Parameters<Repo["saveDailyLog"]>[0]) {
    const { error } = await this.sb
      .from("daily_logs")
      .upsert({ ...omit(d, ["org_id", "id"]), owner_id: this.session.userId, org_id: this.session.orgId }, { onConflict: "org_id,owner_id,log_date" });
    mapError(error);
  }
  async savePlaybook(p: Parameters<Repo["savePlaybook"]>[0]) {
    const { error } = await this.sb.from("playbooks").upsert(omit(p, ["org_id", "updated_at"]));
    mapError(error);
  }
  async deletePlaybook(id: string) {
    const { error } = await this.sb.from("playbooks").delete().eq("id", id);
    mapError(error);
  }
  async loadOrgSettings(): Promise<OrgSettings> {
    const { data, error } = await this.sb.from("organizations").select("settings").eq("id", this.session.orgId).maybeSingle();
    mapError(error);
    return ((data?.settings as OrgSettings | null) ?? {}) as OrgSettings;
  }
  async saveOrgSettings(settings: OrgSettings) {
    // RLS org_update: só admin da própria org. Sem linha afetada = sem permissão.
    const { data, error } = await this.sb.from("organizations").update({ settings }).eq("id", this.session.orgId).select("id");
    mapError(error);
    if (!data?.length) throw new Error("Só o administrador da empresa pode alterar as integrações.");
  }
  async rotateCalendarFeed(): Promise<string> {
    const { data, error } = await this.sb.rpc("rotate_calendar_feed");
    mapError(error);
    if (typeof data !== "string" || !/^[0-9a-f]{64}$/.test(data)) throw new Error("O banco não devolveu o link. A atualização da agenda (SQL 0012) já foi aplicada?");
    return data;
  }
  async updateOrgName(name: string) {
    const { error } = await this.sb.from("organizations").update({ name: name.trim() }).eq("id", this.session.orgId);
    mapError(error);
    this.session = { ...this.session, orgName: name.trim() };
  }

  subscribe(onChange: () => void) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 300);
    };
    const filter = `org_id=eq.${this.session.orgId}`;
    // Nome único por inscrição: o supabase-js reaproveita canais com o mesmo nome, e adicionar
    // callbacks a um canal já inscrito lança erro (derrubava o app quando o efeito rodava 2x).
    const ch = this.sb.channel(`org-${this.session.orgId}-${crypto.randomUUID()}`);
    try {
      for (const table of ["accounts", "visits", "opportunities", "follow_ups", "routes"])
        ch.on("postgres_changes", { event: "*", schema: "public", table, filter }, debounced);
      ch.subscribe();
    } catch (e) {
      // Tempo real é conveniência: se falhar, o app segue funcionando com recarga ao focar a tela.
      console.warn("Realtime indisponível", e);
    }
    return () => {
      clearTimeout(timer);
      void this.sb.removeChannel(ch);
    };
  }
}
