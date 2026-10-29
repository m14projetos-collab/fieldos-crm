// Scripts de WhatsApp da Central de Cadência (Dias 0..90) + pós-visita e pré-visita.
// Base: protótipo HTML (dias 0-15) e objetivos da Central de Cadência no Notion (30, 60, 90).
// Sem nomes fixos: vendedor e empresa vêm da sessão (parametrizável por org).
import { brl } from "./dates";
import type { Account, CadenceStep, FollowUp, Visit } from "./types";

export interface ScriptCtx {
  sellerName: string; // primeiro nome do vendedor
  companyName: string; // ex.: Takeat
}

const who = (a: Account) => a.decision_maker_name?.split(" ")[0] || "tudo bem";
const hi = (a: Account) => (a.decision_maker_name ? `Olá ${who(a)}, tudo bem?` : "Olá, tudo bem?");
const place = (a: Account) => (a.neighborhood ? ` em ${a.neighborhood}` : "");
const systemHook = (a: Account) => {
  const sys = a.current_system?.trim();
  if (!sys || sys.toLowerCase() === "a validar") return "como está o controle de pedidos no horário de pico?";
  if (/planilha|manual/i.test(sys)) return "como está o controle de comandas no horário de pico?";
  return `vocês usam ${sys}: como está a integração salão + delivery no pico?`;
};
const painLine = (a: Account) =>
  a.estimated_monthly_pain_brl && a.estimated_monthly_pain_brl > 0
    ? ` (aquela perda estimada de ${brl(a.estimated_monthly_pain_brl)}/mês)`
    : "";

export const CADENCE_GOAL: Record<CadenceStep, string> = {
  0: "Primeiro contato: abrir conversa e validar interesse",
  2: "Segunda tentativa: retomar contato",
  5: "Envio de material: educar e gerar contexto",
  7: "Ligação consultiva: entender dores e qualificar",
  10: "Convite para demonstração",
  15: "Follow-up: recuperar resposta",
  30: "Reativação: reabrir oportunidade",
  60: "Nova abordagem: testar novo timing",
  90: "Última tentativa antes da Recuperação",
};

export function cadenceScript(step: CadenceStep, a: Account, c: ScriptCtx): string {
  switch (step) {
    case 0:
      return `${hi(a)} Aqui é o ${c.sellerName}, da ${c.companyName}. Vi a operação da ${a.name}${place(a)} e fiquei curioso: ${systemHook(a)} Posso passar aí rapidinho esta semana?`;
    case 2:
      return `${hi(a)} Passando para retomar nosso contato sobre a ${a.name}. Você já parou para calcular quanto fica na mesa por mês entre taxa de app e retrabalho de comanda?`;
    case 5:
      return `${hi(a)} Separei um material curto de como restaurantes de ${a.segment || "foodservice"}${place(a)} organizam salão, cozinha e delivery num fluxo só. Te mando por aqui?`;
    case 7:
      return `${hi(a)} Consigo te ligar 3 minutos hoje, antes do movimento, para entender onde mais trava o fluxo entre pedido, cozinha e entrega na ${a.name}?`;
    case 10:
      return `${hi(a)} Vou estar${place(a)} nos próximos dias com a demonstração da ${c.companyName} (comanda, cardápio digital e PDV). Qual horário fica melhor para você, antes ou depois do almoço?`;
    case 15:
      return `${hi(a)} Sobre a ${a.name}${painLine(a)}: faz mais sentido começarmos pelo cardápio digital ou já virar comanda e PDV juntos?`;
    case 30:
      return `${hi(a)} Faz um tempo que conversamos sobre a operação da ${a.name}. Mudou alguma coisa no movimento ou no sistema desde então?`;
    case 60:
      return `${hi(a)} Muitos restaurantes${place(a)} preferem ajustar sistema fora da alta temporada. Como está o calendário da ${a.name} para as próximas semanas?`;
    case 90:
      return `${hi(a)} Última mensagem para não ficar insistindo: se em algum momento quiser reduzir comissão de app e erro de comanda na ${a.name}, é só me chamar por aqui.`;
  }
}

export function preVisitScript(a: Account, v: Visit, c: ScriptCtx, time: string): string {
  return `${hi(a)} Aqui é o ${c.sellerName}, da ${c.companyName}. Confirmando nossa conversa hoje às ${time} na ${a.name}. Leva uns 20 minutos e não atrapalha o movimento. Combinado?`;
}

export function followUpScript(fu: FollowUp, a: Account, c: ScriptCtx, visit?: Visit): string {
  if (fu.cadence_step != null) return cadenceScript(fu.cadence_step, a, c);
  if (visit?.outcome === "proposta_solicitada" || fu.channel === "proposta")
    return `${hi(a)} Conforme combinamos na visita, segue a proposta da ${c.companyName} para a ${a.name}. Qual o melhor momento para eu te explicar em 5 minutos?`;
  if (visit?.outcome === "fechado")
    return `${hi(a)} Passando para saber como está a primeira semana com a ${c.companyName} na ${a.name}. A equipe já está usando sem depender de você? E você conhece outro restaurante com a mesma dor que eu poderia ajudar?`;
  if (visit?.outcome === "sem_interesse")
    return cadenceScript(60, a, c);
  return `${hi(a)} Obrigado pela conversa na ${a.name}! Como combinamos, estou retomando para alinharmos o próximo passo. Qual dia fica melhor para você?`;
}

export function waLink(phone: string | null | undefined, text: string): string | null {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits; // assume Brasil se vier sem DDI
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}

export function mapsLink(a: Account): string | null {
  if (a.latitude != null && a.longitude != null)
    return `https://www.google.com/maps/dir/?api=1&destination=${a.latitude},${a.longitude}`;
  const q = [a.address, a.neighborhood, a.city].filter(Boolean).join(", ");
  if (!q) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}
