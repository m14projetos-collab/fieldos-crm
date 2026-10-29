// Tipos espelham as tabelas do Supabase (snake_case, mesmos nomes de coluna).

export type AccountStatus =
  | "lead_frio" | "novo_lead" | "lead_importado" | "a_validar"
  | "primeiro_contato" | "discovery" | "agendado" | "demo_realizada"
  | "proposta_enviada" | "negociacao" | "fechado" | "perdido";
export type Priority = "alta" | "media" | "baixa";
export type Interest = "frio" | "morno" | "quente";
export type Persona = "dono_operacional" | "socio_financeiro" | "gerente_contratado";
export type PreferredChannel =
  | "whatsapp" | "ligacao" | "visita" | "email" | "instagram"
  | "indicacao" | "evento" | "cliente_antigo" | "recuperacao";
export type VisitStatus = "agendada" | "em_andamento" | "realizada" | "cancelada" | "reagendada";
export type VisitType = "primeiro_contato" | "demonstracao" | "proposta" | "retorno" | "fechamento" | "pos_venda";
export type VisitOutcome =
  | "interesse_confirmado" | "proposta_solicitada" | "retorno_necessario" | "sem_interesse" | "fechado";
export type OppStage =
  | "lead" | "qualificado" | "demo_agendada" | "proposta_enviada" | "negociacao" | "fechado" | "perdido";
export type FollowUpStatus = "pendente" | "concluido" | "sem_resposta" | "cancelado";
export type FollowUpChannel = "ligacao" | "whatsapp" | "email" | "visita" | "proposta";
export type CadenceStep = 0 | 2 | 5 | 7 | 10 | 15 | 30 | 60 | 90;

export interface PainInputs {
  orders_month?: number;
  avg_ticket?: number;
  commission_pct?: number;
  errors_month?: number;
  migration_share_pct?: number;
  system_price?: number;
}

export interface Account {
  id: string;
  org_id: string;
  owner_id: string | null;
  name: string;
  status: AccountStatus;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  decision_maker_name: string | null;
  internal_contact: string | null;
  persona: Persona;
  address: string | null;
  city: string | null;
  region: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  segment: string | null;
  company_size: string | null;
  current_system: string | null;
  acquisition_source: string | null;
  priority: Priority;
  interest_level: Interest;
  preferred_channel: PreferredChannel;
  last_channel_used: string | null;
  first_contact_date: string | null;
  last_interaction_at: string | null;
  loss_reason: string | null;
  post_sale_phase: string | null;
  cadence_day: CadenceStep;
  pain_inputs: PainInputs;
  estimated_monthly_pain_brl: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Visit {
  id: string;
  org_id: string;
  account_id: string;
  route_id: string | null;
  route_order: number | null;
  owner_id: string | null;
  scheduled_at: string;
  duration_minutes: number;
  status: VisitStatus;
  visit_type: VisitType;
  outcome: VisitOutcome | null;
  completed_at: string | null;
  checkin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Opportunity {
  id: string;
  org_id: string;
  account_id: string;
  owner_id: string | null;
  title: string;
  stage: OppStage;
  plan_name: string | null;
  mrr_value: number;
  probability: number;
  expected_close_date: string | null;
  proposal_sent_at: string | null;
  closed_at: string | null;
  conversion_channel: string | null;
  stage_changed_at: string;
  created_at: string;
  updated_at: string;
}

export interface FollowUp {
  id: string;
  org_id: string;
  account_id: string;
  visit_id: string | null;
  opportunity_id: string | null;
  owner_id: string | null;
  title: string;
  due_date: string; // YYYY-MM-DD
  status: FollowUpStatus;
  channel: FollowUpChannel;
  priority: Priority;
  cadence_step: CadenceStep | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface Goal {
  id: string;
  org_id: string;
  owner_id: string | null;
  title: string;
  category: "visitas" | "demonstracoes" | "propostas" | "vendas" | "receita_mrr" | "novos_leads";
  period_type: "diaria" | "semanal" | "mensal";
  start_date: string;
  end_date: string;
  target_value: number;
}

export interface Session {
  orgId: string;
  orgName: string;
  userId: string;
  userName: string;
  timezone: string;
  mode: "demo" | "supabase";
}

/** Tudo que a UI precisa, carregado uma vez e mantido no cache do TanStack Query. */
export interface Snapshot {
  accounts: Account[];
  visits: Visit[];
  opportunities: Opportunity[];
  followUps: FollowUp[];
  goals: Goal[];
}
