// Rótulos de exibição. O banco guarda slugs; aqui fica o texto/emoji (parametrizável por org na Fase 4).
import type {
  AccountStatus, CadenceStep, FollowUpChannel, Interest, OppStage, Persona,
  Priority, VisitOutcome, VisitType,
} from "./types";

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  lead_frio: "Lead Frio",
  novo_lead: "Novo Lead",
  lead_importado: "Lead Importado",
  a_validar: "A Validar",
  primeiro_contato: "Primeiro Contato",
  discovery: "Discovery Comercial",
  agendado: "Agendado",
  demo_realizada: "Demo Realizada",
  proposta_enviada: "Proposta Enviada",
  negociacao: "Negociação",
  fechado: "Fechado ✅",
  perdido: "Perdido ❌",
};

export const ACTIVE_STATUSES: AccountStatus[] = [
  "primeiro_contato", "discovery", "agendado", "demo_realizada", "proposta_enviada", "negociacao",
];

export const STATUS_RANK: Record<AccountStatus, number> = {
  perdido: 0, lead_frio: 0, novo_lead: 1, lead_importado: 1, a_validar: 1,
  primeiro_contato: 2, discovery: 3, agendado: 4, demo_realizada: 5,
  proposta_enviada: 6, negociacao: 7, fechado: 99,
};

export const PRIORITY_LABEL: Record<Priority, string> = { alta: "🔴 Alta", media: "🟡 Média", baixa: "🟢 Baixa" };
export const INTEREST_LABEL: Record<Interest, string> = { frio: "Frio", morno: "Morno", quente: "Quente" };
export const PERSONA_LABEL: Record<Persona, string> = {
  dono_operacional: "Dono Operacional",
  socio_financeiro: "Sócio Financeiro",
  gerente_contratado: "Gerente Contratado",
};

export const VISIT_TYPE_LABEL: Record<VisitType, string> = {
  primeiro_contato: "🤝 Primeiro Contato",
  demonstracao: "📊 Demonstração",
  proposta: "📝 Proposta",
  retorno: "🔄 Retorno",
  fechamento: "✅ Fechamento",
  pos_venda: "🤝 Pós-venda",
};

export const OUTCOME_LABEL: Record<VisitOutcome, string> = {
  interesse_confirmado: "✅ Interesse confirmado",
  proposta_solicitada: "📝 Proposta solicitada",
  retorno_necessario: "🔄 Retorno necessário",
  sem_interesse: "❌ Sem interesse",
  fechado: "🎉 Fechado!",
};

export const STAGE_LABEL: Record<OppStage, string> = {
  lead: "Lead",
  qualificado: "Qualificado",
  demo_agendada: "Demo / Visita",
  proposta_enviada: "Proposta Enviada",
  negociacao: "Negociação",
  fechado: "Fechado ✅",
  perdido: "Perdido ❌",
};
export const STAGE_RANK: Record<OppStage, number> = {
  perdido: 0, lead: 1, qualificado: 2, demo_agendada: 3, proposta_enviada: 4, negociacao: 5, fechado: 99,
};
export const STAGE_PROBABILITY: Record<OppStage, number> = {
  lead: 20, qualificado: 35, demo_agendada: 50, proposta_enviada: 65, negociacao: 80, fechado: 100, perdido: 0,
};
export const OPEN_STAGES: OppStage[] = ["lead", "qualificado", "demo_agendada", "proposta_enviada", "negociacao"];

export const CHANNEL_LABEL: Record<FollowUpChannel, string> = {
  ligacao: "📞 Ligação",
  whatsapp: "💬 WhatsApp",
  email: "📧 E-mail",
  visita: "🤝 Visita",
  proposta: "📊 Proposta",
};

export const CADENCE_STEPS: CadenceStep[] = [0, 2, 5, 7, 10, 15, 30, 60, 90];

export function nextCadenceStep(step: CadenceStep | null): CadenceStep | null {
  const cur = step ?? -1;
  return CADENCE_STEPS.find((s) => s > cur) ?? null;
}

export const NEXT_BEST_ACTION_LABEL: Record<string, string> = {
  recuperar_oportunidade: "Recuperar oportunidade",
  encerrar_negociacao: "Encerrar negociação (contato inválido)",
  pos_venda_indicacao: "Pós-venda 7 dias + pedir indicação",
  ligar_agora: "Ligar agora (lead quente)",
  cobrar_decisao: "Cobrar decisão da proposta",
  enviar_proposta_final: "Enviar proposta final",
  fazer_visita: "Fazer visita em campo",
  enviar_whatsapp: "Enviar WhatsApp",
  ligar_conexao: "Ligar (Conexão CHAVE)",
  whatsapp_dia_0: "WhatsApp Dia 0",
  ligar: "Ligar",
};

export const MISSING_FIELD_LABEL: Record<string, string> = {
  telefone: "Telefone/WhatsApp",
  regiao: "Região",
  bairro: "Bairro",
  follow_up: "Próximo follow-up",
};

/** Padrões do Quick Log (mesmos valores de log_visit_outcome no SQL). */
export const OUTCOME_DEFAULTS: Record<VisitOutcome, { days: number; channel: FollowUpChannel; title: string }> = {
  interesse_confirmado: { days: 2, channel: "whatsapp", title: "Retorno pós-visita: confirmar demonstração" },
  proposta_solicitada: { days: 1, channel: "proposta", title: "Enviar proposta solicitada na visita" },
  retorno_necessario: { days: 3, channel: "whatsapp", title: "Retorno combinado na visita" },
  sem_interesse: { days: 90, channel: "whatsapp", title: "Recuperação: nova abordagem (Central de Recuperação)" },
  fechado: { days: 7, channel: "visita", title: "Pós-venda 7 dias: confirmar resultado e pedir indicação" },
};
