// Calculadora de Ancoragem de Dor (Método CHAVE: valor antes do preço).
// Premissas explícitas e editáveis; nada é escondido do vendedor nem do cliente.
import type { PainInputs } from "./types";

export const PAIN_DEFAULTS: Required<PainInputs> = {
  orders_month: 0,          // pedidos/mês via marketplace
  avg_ticket: 0,            // R$
  commission_pct: 23,       // % de comissão do marketplace
  errors_month: 0,          // erros de comanda/mês
  migration_share_pct: 20,  // % dos pedidos que dá para migrar ao canal próprio (premissa)
  system_price: 0,          // mensalidade do sistema, R$
};

export interface PainResult {
  commissionMonth: number;   // comissão paga hoje
  commissionAvoidable: number; // parte evitável migrando para canal próprio
  errorsMonth: number;       // custo dos erros (1 ticket perdido por erro: premissa)
  inactionCost: number;      // custo mensal da inação = evitável + erros
  paybackDays: number | null; // dias para o sistema se pagar
}

export function computePain(raw: PainInputs): PainResult {
  const i = { ...PAIN_DEFAULTS, ...raw };
  const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  const commissionMonth = n(i.orders_month) * n(i.avg_ticket) * (n(i.commission_pct) / 100);
  const commissionAvoidable = commissionMonth * (n(i.migration_share_pct) / 100);
  const errorsMonth = n(i.errors_month) * n(i.avg_ticket);
  const inactionCost = commissionAvoidable + errorsMonth;
  const paybackDays = n(i.system_price) > 0 && inactionCost > 0 ? (n(i.system_price) / inactionCost) * 30 : null;
  const r = (v: number) => Math.round(v);
  return {
    commissionMonth: r(commissionMonth),
    commissionAvoidable: r(commissionAvoidable),
    errorsMonth: r(errorsMonth),
    inactionCost: r(inactionCost),
    paybackDays: paybackDays == null ? null : Math.round(paybackDays * 10) / 10,
  };
}
