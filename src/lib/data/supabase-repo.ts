// Modo Supabase: leituras com RLS + ações rápidas via RPC atômica (regras no banco).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account, FollowUp, Goal, Opportunity, Session, Snapshot, Visit } from "@/lib/domain/types";
import { DomainError } from "@/lib/domain/transitions";
import { type Repo, pickUpdatable } from "./repo";

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
  if (e.hint === "NEXT_FOLLOWUP_REQUIRED") throw new DomainError("NEXT_FOLLOWUP_REQUIRED", e.message ?? "");
  if (e.code === "P0002") throw new DomainError("NOT_FOUND", e.message ?? "Não encontrado");
  if (e.code === "22023") throw new DomainError("INVALID", e.message ?? "Inválido");
  throw new Error(e.message ?? "Erro no Supabase");
}

export class SupabaseRepo implements Repo {
  constructor(private sb: SupabaseClient, public session: Session) {}

  async load(): Promise<Snapshot> {
    const [accounts, visits, opportunities, followUps, goals] = await Promise.all([
      fetchAll<Account>(this.sb, "accounts"),
      fetchAll<Visit>(this.sb, "visits"),
      fetchAll<Opportunity>(this.sb, "opportunities"),
      fetchAll<FollowUp>(this.sb, "follow_ups"),
      fetchAll<Goal>(this.sb, "goals"),
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
    return data as string;
  }

  async scheduleVisit(i: Parameters<Repo["scheduleVisit"]>[0]) {
    const { data, error } = await this.sb.rpc("schedule_visit", {
      p_account_id: i.accountId, p_scheduled_at: i.scheduledAt, p_visit_type: i.visitType,
      p_duration: i.durationMinutes ?? 45, p_id: i.id,
    });
    mapError(error);
    return data as string;
  }

  async updateAccount(id: string, patch: Partial<Account>) {
    const { error } = await this.sb.from("accounts").update(pickUpdatable(patch)).eq("id", id);
    mapError(error);
  }

  subscribe(onChange: () => void) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(onChange, 300);
    };
    const filter = `org_id=eq.${this.session.orgId}`;
    const ch = this.sb.channel(`org-${this.session.orgId}`);
    for (const table of ["accounts", "visits", "opportunities", "follow_ups"])
      ch.on("postgres_changes", { event: "*", schema: "public", table, filter }, debounced);
    ch.subscribe();
    return () => {
      clearTimeout(timer);
      void this.sb.removeChannel(ch);
    };
  }
}
