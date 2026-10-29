// Dados fictícios para o modo demo (nenhum restaurante real). Datas relativas a "hoje".
import { addDays, dateInTz, monthStart } from "@/lib/domain/dates";

const addMonth = (d: string) => {
  const [y, m] = d.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
};
import type { Account, FollowUp, Goal, Opportunity, Snapshot, Visit } from "@/lib/domain/types";

export const DEMO_ORG = "00000000-0000-4000-8000-000000000001";
export const DEMO_USER = "00000000-0000-4000-8000-000000000002";

export function buildDemoSnapshot(tz: string, now = new Date()): Snapshot {
  const today = dateInTz(now, tz);
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
  const at = (hhmm: string) => {
    // horário local de SP (UTC-3) para hoje
    const [h, m] = hhmm.split(":").map(Number);
    const [y, mo, d] = today.split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, d, h + 3, m)).toISOString();
  };

  const acc = (id: string, p: Partial<Account>): Account => ({
    id, org_id: DEMO_ORG, owner_id: DEMO_USER, name: "", status: "novo_lead", phone: null, whatsapp: null,
    email: null, decision_maker_name: null, internal_contact: null, persona: "dono_operacional", address: null,
    city: "Rio de Janeiro", region: "Oeste", neighborhood: null, latitude: null, longitude: null, segment: null,
    company_size: null, current_system: null, acquisition_source: "Prospecção Ativa", priority: "media",
    interest_level: "morno", preferred_channel: "whatsapp", last_channel_used: null, first_contact_date: null,
    last_interaction_at: null, loss_reason: null, post_sale_phase: null, cadence_day: 0, pain_inputs: {},
    estimated_monthly_pain_brl: null, notes: null, created_at: iso(20), updated_at: iso(1), ...p,
  });

  const accounts: Account[] = [
    acc("a1", { name: "Cantina Exemplo da Posse", status: "agendado", whatsapp: "21900000001", decision_maker_name: "Marcos (fictício)", neighborhood: "Campo Grande", address: "Estrada do Exemplo, 100", segment: "Pizzaria", current_system: "Saipos", priority: "alta", interest_level: "quente", persona: "dono_operacional", last_interaction_at: iso(3), cadence_day: 5 }),
    acc("a2", { name: "Burger Demo Bangu", status: "discovery", whatsapp: "21900000002", decision_maker_name: "Carla (fictícia)", neighborhood: "Bangu", address: "Rua Demonstração, 45", segment: "Hamburgueria", current_system: "Anota AI", priority: "alta", interest_level: "morno", persona: "socio_financeiro", last_interaction_at: iso(6), cadence_day: 7 }),
    acc("a3", { name: "Bistrô Teste Recreio", status: "proposta_enviada", whatsapp: "21900000003", decision_maker_name: "Renato (fictício)", neighborhood: "Recreio", address: "Av. Fictícia, 900", segment: "Restaurante", current_system: "Planilha / Manual", priority: "media", interest_level: "quente", persona: "gerente_contratado", last_interaction_at: iso(10), estimated_monthly_pain_brl: 3200 }),
    acc("a4", { name: "Açaí Modelo Santa Cruz", status: "primeiro_contato", whatsapp: "21900000004", neighborhood: "Santa Cruz", segment: "Açaiteria", current_system: "iFood Gestor", priority: "baixa", interest_level: "frio", last_interaction_at: iso(18), cadence_day: 2 }),
    acc("a5", { name: "Churrascaria Amostra Barra", status: "negociacao", whatsapp: "21900000005", decision_maker_name: "Sônia (fictícia)", neighborhood: "Barra da Tijuca", address: "Av. das Amostras, 3000", segment: "Churrascaria", current_system: "Yogga", priority: "alta", interest_level: "quente", persona: "socio_financeiro", last_interaction_at: iso(9) }),
    acc("a6", { name: "Lanchonete Protótipo", status: "novo_lead", whatsapp: "21900000006", neighborhood: "Campo Grande", segment: "Lanchonete", created_at: iso(0) }),
    acc("a7", { name: "Pizzaria Simulada Paciência", status: "fechado", whatsapp: "21900000007", decision_maker_name: "João (fictício)", neighborhood: "Paciência", segment: "Pizzaria", current_system: "Takeat", priority: "media", interest_level: "quente", post_sale_phase: "onboarding", last_interaction_at: iso(4) }),
    acc("a8", { name: "Bar Ilustrativo", status: "discovery", phone: null, whatsapp: null, neighborhood: null, segment: "Bar e Petisco", priority: "media", interest_level: "morno", last_interaction_at: iso(2) }),
  ];

  const visit = (id: string, account_id: string, time: string, p: Partial<Visit> = {}): Visit => ({
    id, org_id: DEMO_ORG, account_id, route_id: null, route_order: null, owner_id: DEMO_USER,
    scheduled_at: at(time), duration_minutes: 45, status: "agendada", visit_type: "primeiro_contato", outcome: null,
    completed_at: null, checkin_notes: null, created_at: iso(2), updated_at: iso(2), ...p,
  });
  const visits: Visit[] = [
    visit("v0", "a7", "09:00", { status: "realizada", outcome: "fechado", visit_type: "fechamento", completed_at: at("09:50") }),
    visit("v1", "a1", "11:00", { visit_type: "demonstracao" }),
    visit("v2", "a2", "14:30", { visit_type: "retorno" }),
    visit("v3", "a5", "16:30", { visit_type: "fechamento", duration_minutes: 30 }),
  ];

  const opp = (id: string, account_id: string, p: Partial<Opportunity>): Opportunity => ({
    id, org_id: DEMO_ORG, account_id, owner_id: DEMO_USER, title: "", stage: "qualificado", plan_name: "Takeat Pro + PDV + Cardápio",
    mrr_value: 0, probability: 35, expected_close_date: null, proposal_sent_at: null, closed_at: null,
    conversion_channel: "visita_presencial", stage_changed_at: iso(5), created_at: iso(15), updated_at: iso(2), ...p,
  });
  const opportunities: Opportunity[] = [
    opp("o1", "a1", { title: "Cantina Exemplo — PDV + comanda", stage: "demo_agendada", probability: 50, mrr_value: 389 }),
    opp("o3", "a3", { title: "Bistrô Teste — cardápio digital", stage: "proposta_enviada", probability: 65, mrr_value: 259, proposal_sent_at: addDays(today, -10), updated_at: iso(10), stage_changed_at: iso(10) }),
    opp("o5", "a5", { title: "Churrascaria Amostra — 2 unidades", stage: "negociacao", probability: 80, mrr_value: 690, proposal_sent_at: addDays(today, -6) }),
    opp("o7", "a7", { title: "Pizzaria Simulada — Pro", stage: "fechado", probability: 100, mrr_value: 289, closed_at: today }),
  ];

  const fu = (id: string, account_id: string, due: number, p: Partial<FollowUp>): FollowUp => ({
    id, org_id: DEMO_ORG, account_id, visit_id: null, opportunity_id: null, owner_id: DEMO_USER, title: "",
    due_date: addDays(today, due), status: "pendente", channel: "whatsapp", priority: "media", cadence_step: null,
    completed_at: null, notes: null, created_at: iso(3), ...p,
  });
  const followUps: FollowUp[] = [
    fu("f1", "a1", 0, { title: "Visita agendada", channel: "visita", priority: "alta", visit_id: "v1" }),
    fu("f2", "a2", 0, { title: "Visita agendada", channel: "visita", priority: "alta", visit_id: "v2" }),
    fu("f3", "a3", -3, { title: "Cobrar retorno da proposta", channel: "proposta", priority: "alta", opportunity_id: "o3" }),
    fu("f4", "a4", -1, { title: "Cadência Dia 2", cadence_step: 2 }),
    fu("f5", "a5", 0, { title: "Visita agendada", channel: "visita", priority: "alta", visit_id: "v3" }),
    fu("f6", "a6", 0, { title: "Cadência Dia 0: primeiro contato", cadence_step: 0, priority: "alta" }),
    fu("f7", "a7", 7, { title: "Pós-venda 7 dias: confirmar resultado e pedir indicação", channel: "visita", visit_id: "v0" }),
    fu("f0", "a2", -8, { title: "Cadência Dia 0", cadence_step: 0, status: "concluido", completed_at: iso(8) }),
  ];

  const goals: Goal[] = [
    { id: "g1", org_id: DEMO_ORG, owner_id: DEMO_USER, title: "Visitas do dia", category: "visitas", period_type: "diaria", start_date: addDays(today, -365), end_date: addDays(today, 365), target_value: 6 },
    { id: "g2", org_id: DEMO_ORG, owner_id: null, title: "Vendas do mês", category: "vendas", period_type: "mensal", start_date: monthStart(today), end_date: addDays(addMonth(monthStart(today)), -1), target_value: 8 },
    { id: "g3", org_id: DEMO_ORG, owner_id: null, title: "MRR novo do mês", category: "receita_mrr", period_type: "mensal", start_date: monthStart(today), end_date: addDays(addMonth(monthStart(today)), -1), target_value: 2400 },
  ];

  return { accounts, visits, opportunities, followUps, goals, routes: [], dailyLogs: [], playbooks: [] };
}
