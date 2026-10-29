// Método CHAVE e ICP Takeat (fonte: Workspace Comercial Takeat, seções 6 e 7).
// Tudo determinístico: a auditoria pontua por checklist respondido pelo vendedor, não por palavra-chave.
import type { Account, ChaveAudit, ChaveKey, FollowUp, IcpChecklist, IcpKey, Opportunity, Persona, Priority, Visit } from "./types";

// ---------------------------------------------------------------------------
// ICP: qualificação rápida em 5 perguntas
// ---------------------------------------------------------------------------
export const ICP_QUESTIONS: { key: IcpKey; label: string; hint: string }[] = [
  { key: "dor", label: "Sente dor concreta?", hint: "Fila, erro de pedido, comissão, caixa que não fecha. Ele fala do problema sem você puxar." },
  { key: "volume", label: "Há volume que justifique?", hint: "Pedidos/dia, mesas, delivery relevante. Sabe dizer o número." },
  { key: "decisor", label: "Quem fala decide ou influencia forte?", hint: "Dono, sócio ou gerente com autonomia real e acesso ao decisor." },
  { key: "concorrente", label: "Já usa ou testou concorrente?", hint: "Saipos, Yogga, Colibri, Anota AI, iFood Gestor: sinal de maturidade." },
  { key: "timing", label: "Há orçamento ou timing em 30 a 60 dias?", hint: "Fora do pico, sem obra, com dinheiro para começar." },
];

export type IcpVerdict = "pipeline" | "nutricao" | "incompleto";

export function icpResult(c: IcpChecklist | undefined | null) {
  const answers = ICP_QUESTIONS.map((q) => c?.[q.key]);
  const yes = answers.filter((v) => v === true).length;
  const no = answers.filter((v) => v === false).length;
  const answered = yes + no;
  // Regra do ICP: três ou mais "não" = lead de nutrição, não de pipeline ativo
  const verdict: IcpVerdict = no >= 3 ? "nutricao" : answered === ICP_QUESTIONS.length ? "pipeline" : "incompleto";
  // Calibragem da Prioridade: Alta = dor + volume + decisor + timing; Média = tem dor, falta algo; Baixa = sem dor
  let priority: Priority | null = null;
  if (c?.dor === false) priority = "baixa";
  else if (c?.dor && c.volume && c.decisor && c.timing) priority = "alta";
  else if (c?.dor) priority = "media";
  return { yes, no, answered, verdict, priority };
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------
export const PERSONA_GUIDE: Record<Persona, {
  decide: string; goodFit: string[]; badFit: string[]; hipotese: string; ancoragem: string;
}> = {
  dono_operacional: {
    decide: "Facilidade de uso da equipe e velocidade de implantação.",
    goodFit: ["Reclama da operação sem ser perguntado", "Já testou ou usa concorrente", "Tem volume visível", "Sabe dizer onde o processo trava", "Fala em urgência prática"],
    badFit: ["Não sabe o volume de pedidos", "Trata tecnologia como capricho", "Operação simples demais", "Não reconhece custo do erro", "Só quer \"ver sistema\""],
    hipotese: "Onde trava no pico: pedido, cozinha, caixa, entrega ou atendimento?",
    ancoragem: "Quantos pedidos saem errados por semana e quanto custa refazer cada um?",
  },
  socio_financeiro: {
    decide: "Redução de erro, comissão de app e relatório de gestão.",
    goodFit: ["Cita números sem ser perguntado", "Já fez conta do que perde", "Pergunta de ROI e payback", "Se incomoda com falta de relatório"],
    badFit: ["Não conhece os números básicos", "A decisão não passa por ele", "Só quer preço baixo", "Pede desconto antes de reconhecer valor"],
    hipotese: "Quanto vai por mês em comissão de app e em sistema hoje?",
    ancoragem: "Se 20% dos pedidos do app fossem para o canal próprio, quanto sobraria por mês?",
  },
  gerente_contratado: {
    decide: "Não ter que treinar a equipe de novo (e não se expor ao dono).",
    goodFit: ["Tem autonomia real para aprovar ou influenciar", "Já pensa em como apresentar ao dono", "Pede material de apoio", "Explica quem decide e em quanto tempo"],
    badFit: ["Sem autonomia e dono ausente", "Só cumpre tarefa de receber vendedor", "Alta rotatividade no cargo", "Sem acesso ao decisor"],
    hipotese: "Do que o dono mais te cobra hoje, e o que mais toma seu tempo no turno?",
    ancoragem: "Quanto tempo leva para fechar o caixa e quantas vezes ele não bate no mês?",
  },
};

// ---------------------------------------------------------------------------
// Objeções (tabela do método) + pergunta de isolamento pronta para usar
// ---------------------------------------------------------------------------
export interface Objection {
  id: string;
  objection: string;
  really: string;
  answer: string;
  isolate: string;
  stage: ChaveKey;
  personas: Persona[];
}

export const OBJECTIONS: Objection[] = [
  {
    id: "pensar", objection: "Vou pensar", really: "Falta de urgência ou medo de decidir errado",
    answer: "Isolar: o que especificamente quer pensar melhor.",
    isolate: "Claro. Pra eu te ajudar a pensar: o que pesa mais hoje, o valor, o momento de implantar ou alguém que precisa aprovar junto?",
    stage: "virada", personas: ["dono_operacional", "socio_financeiro", "gerente_contratado"],
  },
  {
    id: "caro", objection: "Tá caro", really: "O valor não ficou claro na Ancoragem",
    answer: "Voltar ao custo da inação, sem desconto de cara.",
    isolate: "Caro comparado a quê? Você me disse que perde cerca de R$ [valor] por mês com [dor]. O investimento cabe dentro disso?",
    stage: "ancoragem", personas: ["socio_financeiro", "dono_operacional"],
  },
  {
    id: "outro_sistema", objection: "Já uso outro sistema", really: "Migração parece trabalhosa, nem sempre insatisfação",
    answer: "Perguntar o que mudaria no sistema atual se pudesse.",
    isolate: "Faz sentido. Se você pudesse mudar uma coisa no [sistema atual] amanhã, o que seria?",
    stage: "hipotese", personas: ["dono_operacional", "socio_financeiro", "gerente_contratado"],
  },
  {
    id: "equipe", objection: "Minha equipe não vai aprender", really: "Medo de treinar de novo",
    answer: "Ancorar o tempo real de implantação, sem \"é fácil\" genérico.",
    isolate: "Quem da equipe você acha que teria mais dificuldade? A gente desenha o treinamento em cima dessa pessoa, no turno mais tranquilo.",
    stage: "ancoragem", personas: ["gerente_contratado", "dono_operacional"],
  },
  {
    id: "ifood", objection: "iFood já me atende", really: "Não enxerga a comissão como problema resolvível",
    answer: "Voltar ao número de comissão da Ancoragem.",
    isolate: "Quanto foi de comissão no último mês? Se uma parte desses clientes pedisse direto com você, quanto ficaria no seu caixa?",
    stage: "ancoragem", personas: ["socio_financeiro", "dono_operacional"],
  },
  {
    id: "movimento", objection: "Não quero trocar no meio do movimento", really: "Timing, real e válido",
    answer: "Perguntar o período de menor movimento para alinhar a implantação.",
    isolate: "Totalmente justo. Qual é a semana mais tranquila do seu mês? Já deixo a implantação marcada pra ela.",
    stage: "virada", personas: ["dono_operacional", "gerente_contratado"],
  },
  {
    id: "socio", objection: "Preciso ver com meu sócio", really: "Pode ser real; mais forte com sócio financeiro ausente do dia a dia",
    answer: "Perguntar o que essa pessoa prioriza e ajudar a montar o argumento.",
    isolate: "Perfeito. O que o seu sócio mais vai querer saber: quanto custa, quanto economiza ou quanto tempo leva? Monto isso em uma página pra você levar.",
    stage: "virada", personas: ["gerente_contratado", "dono_operacional"],
  },
];

// ---------------------------------------------------------------------------
// Auditoria CHAVE: checklist de aplicação → nota por etapa (0-10) e a mudança de maior impacto
// ---------------------------------------------------------------------------
export const CHAVE_STAGES: { key: ChaveKey; letter: string; name: string; goal: string }[] = [
  { key: "conexao", letter: "C", name: "Conexão", goal: "Tirar do modo atendimento com algo específico do restaurante, uma pergunta aberta por vez." },
  { key: "hipotese", letter: "H", name: "Hipótese", goal: "Gatilho, tentativas anteriores e custo da inação, antes de falar de solução." },
  { key: "ancoragem", letter: "A", name: "Ancoragem", goal: "O cliente calcula a dor com a própria cabeça antes de ouvir preço." },
  { key: "virada", letter: "V", name: "Virada", goal: "Fechar perguntando \"como\", nunca \"se\". Isolar objeção antes de responder." },
  { key: "extensao", letter: "E", name: "Extensão", goal: "Pedir indicação no fechamento e follow-up de 7 dias pelo resultado." },
];

export const AUDIT_ITEMS: { id: string; stage: ChaveKey; label: string; fix: string }[] = [
  { id: "abertura", stage: "conexao", label: "Abri com algo do cliente, não do produto", fix: "Abra com uma observação da operação dele: \"vi que vocês usam comanda de papel, como fica no pico?\"" },
  { id: "tres_perguntas", stage: "hipotese", label: "Fiz as 3 perguntas da Hipótese antes de falar de solução", fix: "Pergunte nesta ordem: por que agora? o que já tentou? o que acontece se não resolver?" },
  { id: "numero_dor", stage: "ancoragem", label: "O cliente disse um número de custo da dor antes de eu falar preço", fix: "Antes do preço: \"quanto você estima que perde por mês com isso?\" e espere o número dele." },
  { id: "beneficio_resposta", stage: "ancoragem", label: "Conectei cada benefício a uma resposta dele", fix: "Para cada funcionalidade, cite a frase dele: \"você falou que o caixa não bate; aqui ele fecha sozinho\"." },
  { id: "como", stage: "virada", label: "O fechamento foi \"como\", não \"se\"", fix: "Troque \"quer fechar?\" por \"prefere começar essa semana ou mês que vem?\"" },
  { id: "isolei", stage: "virada", label: "Isolei a objeção antes de responder", fix: "Antes de responder, pergunte: \"é o valor, o momento ou alguém que precisa aprovar?\"" },
  { id: "indicacao", stage: "extensao", label: "Pedi indicação no fechamento", fix: "No aperto de mão: \"conhece outro restaurante com essa mesma dor?\"" },
];

export function scoreAudit(answers: Record<string, boolean>, persona: Persona | null, now = new Date()): ChaveAudit & { biggestFix: string | null } {
  const scores = {} as Record<ChaveKey, number>;
  for (const st of CHAVE_STAGES) {
    const items = AUDIT_ITEMS.filter((i) => i.stage === st.key);
    const ok = items.filter((i) => answers[i.id]).length;
    scores[st.key] = Math.round((ok / items.length) * 10);
  }
  const total = Math.round((AUDIT_ITEMS.filter((i) => answers[i.id]).length / AUDIT_ITEMS.length) * 100) / 10;
  // a mudança de maior impacto é a primeira etapa que falhou (pular etapa é o que mais perde venda)
  const first = AUDIT_ITEMS.find((i) => !answers[i.id]);
  return { scores, total, persona, answers, audited_at: now.toISOString(), biggestFix: first ? first.fix : null };
}

export function isAudit(x: unknown): x is ChaveAudit {
  return !!x && typeof x === "object" && "scores" in x && "answers" in x;
}

/** Prompt de auditoria do método, já com o contexto da conta, para colar no Claude/ChatGPT (custo zero). */
export function buildAuditPrompt(acc: Account, opp: Opportunity | null, visits: Visit[], notes: string): string {
  const ctx = [
    `Restaurante: ${acc.name}${acc.segment ? ` (${acc.segment})` : ""}${acc.neighborhood ? `, ${acc.neighborhood}` : ""}`,
    acc.current_system ? `Sistema atual: ${acc.current_system}` : null,
    acc.decision_maker_name ? `Decisor: ${acc.decision_maker_name}` : null,
    opp ? `Etapa no pipeline: ${opp.stage}${opp.mrr_value ? `, MRR em jogo R$ ${opp.mrr_value}` : ""}` : null,
    acc.estimated_monthly_pain_brl ? `Dor calculada com o cliente: R$ ${acc.estimated_monthly_pain_brl}/mês` : null,
  ].filter(Boolean).join("\n");
  const history = visits
    .filter((v) => v.checkin_notes)
    .slice(0, 5)
    .map((v) => `- ${v.scheduled_at.slice(0, 10)} (${v.visit_type}${v.outcome ? `, ${v.outcome}` : ""}): ${v.checkin_notes}`)
    .join("\n");
  return `Você é meu coach de vendas de campo para o sistema Takeat (gestão para restaurantes: comanda, cardápio digital, PDV, integração com apps de delivery). Uso o Método CHAVE (Conexão, Hipótese, Ancoragem, Virada, Extensão). Vou colar abaixo uma conversa ou resumo de visita com um lead (dono, sócio financeiro ou gerente de restaurante). Antes de tudo, identifique qual persona é o decisor: dono operacional, dono/sócio financeiro ausente do dia a dia, ou gerente contratado, e sinalize isso no início da resposta. Depois, analise etapa por etapa: 1. CONEXÃO: abri com algo específico da operação dele? Nota 0-10 e sugestão melhor se necessário. 2. HIPÓTESE: identifiquei gatilho, tentativas anteriores e custo real da dor? Se faltou algo, dê a pergunta exata. 3. ANCORAGEM: o lead colocou um número na dor antes de eu falar do Takeat? Se não, dê a pergunta certa. 4. VIRADA: meu fechamento foi 'se' ou 'como'? Reescreva no formato 'como'. 5. OBJEÇÃO: se apareceu, diga se é real ou cortina, e dê a pergunta de isolamento certa. 6. EXTENSÃO: se fechou, dê a mensagem exata de pedido de indicação. No final: nota geral 0-10 e a única mudança que mais teria impactado o resultado. Seja direto e crítico, não elogie por elogiar.

Contexto do CRM:
${ctx}
${history ? `\nHistórico de visitas:\n${history}\n` : ""}
Conversa/visita:
${notes.trim() || "[COLE AQUI]"}`;
}

// ---------------------------------------------------------------------------
// Termômetro CHAVE: métricas de alerta do método calculadas dos dados reais
// ---------------------------------------------------------------------------
export interface ChaveMetric {
  id: string;
  stage: ChaveKey;
  label: string;
  value: number | null; // 0-1
  base: number; // tamanho da amostra
  threshold: number;
  direction: "min" | "max"; // min = alerta abaixo; max = alerta acima
  how: string;
}

/** Abaixo desta amostra a métrica aparece, mas sem alerta (evita conclusão com 2 ou 3 casos). */
export const MIN_SAMPLE = 10;

export function chaveMetrics(s: { accounts: Account[]; visits: Visit[]; followUps: FollowUp[]; opportunities: Opportunity[] }, today: string): ChaveMetric[] {
  // 1) Resposta após a 1ª mensagem: follow-ups do Dia 0 encerrados como "concluído" vs "sem resposta"
  const d0 = s.followUps.filter((f) => f.cadence_step === 0 && (f.status === "concluido" || f.status === "sem_resposta"));
  const answered = d0.filter((f) => f.status === "concluido").length;
  // 2) Avanço para reunião: contas já contatadas que chegaram a ter visita/demo
  const contacted = s.accounts.filter((a) => a.first_contact_date);
  const withVisit = new Set(s.visits.filter((v) => v.status !== "cancelada").map((v) => v.account_id));
  const met = contacted.filter((a) => withVisit.has(a.id)).length;
  // 3) "Vou pensar" sem retorno: propostas paradas há mais de 7 dias sobre propostas enviadas e ainda abertas/decididas
  const proposals = s.opportunities.filter((o) => o.proposal_sent_at);
  const stalled = proposals.filter(
    (o) => o.stage === "proposta_enviada" && (Date.parse(today) - Date.parse(o.stage_changed_at.slice(0, 10))) / 86_400_000 > 7,
  ).length;
  // 4) Fechamento pós-proposta: ganhas sobre decididas (ganhas + perdidas) entre as que tiveram proposta
  const decided = proposals.filter((o) => o.stage === "fechado" || o.stage === "perdido");
  const won = decided.filter((o) => o.stage === "fechado").length;
  const ratio = (n: number, d: number) => (d ? n / d : null);
  return [
    { id: "resposta", stage: "conexao", label: "Resposta após a 1ª mensagem", value: ratio(answered, d0.length), base: d0.length, threshold: 0.4, direction: "min",
      how: "Abaixo de 40%: problema na Conexão. Abra com algo do restaurante, não do produto." },
    { id: "reuniao", stage: "hipotese", label: "Avanço para reunião/visita", value: ratio(met, contacted.length), base: contacted.length, threshold: 0.3, direction: "min",
      how: "Abaixo de 30%: problema na Hipótese. Faça as 3 perguntas antes de oferecer visita." },
    { id: "pensar", stage: "ancoragem", label: "Propostas paradas há +7 dias", value: ratio(stalled, proposals.length), base: proposals.length, threshold: 0.5, direction: "max",
      how: "Acima de 50%: \"vou pensar\" sem retorno, problema na Ancoragem. O cliente não colocou número na dor." },
    { id: "fechamento", stage: "virada", label: "Fechamento pós-proposta", value: ratio(won, decided.length), base: decided.length, threshold: 0.35, direction: "min",
      how: "Referência em B2B consultivo: acima de 35%. Abaixo disso, revise a Virada (\"como\", não \"se\")." },
  ];
}

export const metricAlert = (m: ChaveMetric) =>
  m.value != null && m.base >= MIN_SAMPLE && (m.direction === "min" ? m.value < m.threshold : m.value > m.threshold);
