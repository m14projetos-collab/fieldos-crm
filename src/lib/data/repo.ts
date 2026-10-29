import type {
  CancelVisitInput, CreateOpportunityInput, MoveOpportunityInput, RescheduleVisitInput, SaveRouteInput, SetAccountStatusInput,
} from "@/lib/domain/pipeline";
import type { DailyLogInput, GoalInput, OppPatch, PlaybookInput } from "@/lib/domain/records";
import type {
  CompleteFollowUpInput, CreateLeadInput, LogVisitInput, ScheduleVisitInput,
} from "@/lib/domain/transitions";
import type { Account, RouteStatus, Session, Snapshot } from "@/lib/domain/types";

/** Contrato único de dados. Duas implementações: demo (localStorage) e Supabase. */
export interface Repo {
  session: Session;
  load(): Promise<Snapshot>;
  logVisitOutcome(input: LogVisitInput): Promise<void>;
  completeFollowUp(input: CompleteFollowUpInput): Promise<void>;
  createLead(input: CreateLeadInput & { id: string }): Promise<string>;
  scheduleVisit(input: ScheduleVisitInput & { id: string }): Promise<string>;
  updateAccount(id: string, patch: Partial<Account>): Promise<void>;
  // Fase 2: pipeline e rotas (RPCs da migration 0009)
  moveOpportunity(input: MoveOpportunityInput): Promise<void>;
  createOpportunity(input: CreateOpportunityInput): Promise<string>;
  setAccountStatus(input: SetAccountStatusInput): Promise<void>;
  updateOpportunity(id: string, patch: OppPatch): Promise<void>;
  cancelVisit(input: CancelVisitInput): Promise<void>;
  rescheduleVisit(input: RescheduleVisitInput): Promise<void>;
  saveRoute(input: SaveRouteInput): Promise<string>;
  setRouteStatus(input: { routeId: string; status: RouteStatus }): Promise<void>;
  // Fase 3/4: metas, daily, playbooks, organização
  saveGoal(goal: GoalInput): Promise<void>;
  deleteGoal(id: string): Promise<void>;
  saveDailyLog(log: DailyLogInput): Promise<void>;
  savePlaybook(p: PlaybookInput): Promise<void>;
  deletePlaybook(id: string): Promise<void>;
  updateOrgName(name: string): Promise<void>;
  /** Avisa quando outra aba/dispositivo mudou algo. Retorna o unsubscribe. */
  subscribe(onChange: () => void): () => void;
}

export const UPDATABLE_ACCOUNT_FIELDS = [
  "name", "phone", "whatsapp", "email", "decision_maker_name", "internal_contact", "persona", "address",
  "city", "region", "neighborhood", "segment", "company_size", "current_system", "priority", "interest_level",
  "preferred_channel", "pain_inputs", "estimated_monthly_pain_brl", "notes", "instagram_url", "website_url",
  "latitude", "longitude", "geo_precision", "icp_checklist",
] as const satisfies readonly (keyof Account)[];

export function pickUpdatable(patch: Partial<Account>): Partial<Account> {
  const out: Record<string, unknown> = {};
  for (const k of UPDATABLE_ACCOUNT_FIELDS) if (k in patch) out[k] = patch[k];
  return out as Partial<Account>;
}
