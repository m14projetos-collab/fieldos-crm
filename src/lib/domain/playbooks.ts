// Playbooks padrão Takeat e a recomendação de script por cliente.
// Conteúdo tirado do Workspace Comercial (Notion): Método CHAVE, tabela de objeções, personas, ICP e Mapa de Mercado.
// Nenhum número de mercado inventado: a Ancoragem usa os números que o próprio cliente diz.
import type { Account, Playbook } from "./types";

export type PlaybookKey =
  | "conexao_90s" | "tres_perguntas" | "ancoragem_ifood" | "battle_pdv" | "battle_delivery" | "virada_como" | "pos_venda_7d";

export interface DefaultPlaybook {
  key: PlaybookKey;
  title: string;
  category: string;
  funnel_stage: string;
  channel: string | null;
  content_md: string;
}

export const DEFAULT_PLAYBOOKS: DefaultPlaybook[] = [
  {
    key: "conexao_90s",
    title: "Conexão 90s",
    category: "Scripts de Venda",
    funnel_stage: "Lead",
    channel: "Visita Presencial",
    content_md: `Objetivo: tirar a conversa do modo atendimento nos primeiros 90 segundos.

1. Abra com uma observação específica do restaurante, nunca com o produto.
   Ex.: "Vi que vocês trabalham com comanda de papel. Como funciona no horário de pico?"
2. Uma pergunta aberta por vez. Espere a resposta inteira antes de falar de produto ou preço.
3. Nos primeiros 30 segundos, identifique a persona: dono operacional, sócio financeiro ou gerente contratado.

Sinal de sucesso: o cliente responde com mais de uma frase ou pergunta de volta.
Alerta: se menos de 40% respondem à 1ª mensagem, o problema está na Conexão.`,
  },
  {
    key: "tres_perguntas",
    title: "3 Perguntas da Hipótese",
    category: "Scripts de Venda",
    funnel_stage: "MQL",
    channel: null,
    content_md: `Faça as três, nesta ordem, sem apresentar solução antes das três respostas:

1. "O que te fez procurar isso agora, e não há alguns meses?" (gatilho e urgência)
2. "O que você já tentou pra resolver isso?" (ceticismo acumulado)
3. "Se isso não for resolvido, o que acontece?" (custo da inação)

Anote as respostas na ficha. Elas viram a Ancoragem e o argumento da proposta.
Alerta: se menos de 30% avançam para reunião, revise a Hipótese.`,
  },
  {
    key: "ancoragem_ifood",
    title: "Ancoragem Matemática iFood",
    category: "Objeções",
    funnel_stage: "SQL",
    channel: null,
    content_md: `Objetivo: o cliente calcula a dor com a própria cabeça ANTES de ouvir preço.

Perguntas (os números são dele, não seus):
1. "Quantos pedidos por mês vêm pelo app de delivery?"
2. "Qual o ticket médio desses pedidos?"
3. "Qual a comissão que você paga hoje?"
→ Conta junto com ele: pedidos × ticket × comissão = R$ por mês só de comissão.
4. "E erro de pedido ou comanda, quanto custa por mês?"

Use a Calculadora de dor na ficha do cliente para registrar o valor.
Só depois mostre a funcionalidade que resolve aquele custo, com exemplo de restaurante do mesmo segmento.
Se o cliente não disse um número, a Ancoragem não aconteceu: não fale de preço ainda.`,
  },
  {
    key: "battle_pdv",
    title: "Battlecard Saipos/Yogga",
    category: "Objeções",
    funnel_stage: "SQL",
    channel: null,
    content_md: `Perfil: já usa sistema de gestão/PDV (Saipos, Yogga, Colibri e similares). Entende valor; a objeção é a migração.

O que costuma ser de verdade: "migrar dá trabalho", nem sempre insatisfação.

Roteiro:
1. "Se você pudesse mudar uma coisa no sistema atual, o que seria?" (descobre a dor real)
2. "Quanto tempo a equipe levou para aprender o sistema atual?" (ancora o medo de treinar)
3. Responda com o tempo real de implantação, sem "é fácil" genérico.
4. Se a objeção for timing: "Qual o período de menor movimento?" e alinhe a implantação para ele.

Não ataque o concorrente. Compare só o que o cliente disse que trava.`,
  },
  {
    key: "battle_delivery",
    title: "Battlecard Anota AI/iFood",
    category: "Objeções",
    funnel_stage: "SQL",
    channel: null,
    content_md: `Perfil: usa Anota AI, iFood Gestor ou cardápio de delivery (MenuDino, OlaClick, InstaDelivery e similares). Abre conversa sobre canal próprio e comissão.

Objeção típica: "O iFood já me atende." Na verdade: não enxerga a comissão como problema resolvível.

Roteiro:
1. Volte ao número de comissão da Ancoragem (ver "Ancoragem Matemática iFood").
2. "Quantos desses clientes já pediram mais de uma vez? Eles poderiam pedir direto com você?"
3. Mostre o canal próprio como complemento do app, não como troca: o cliente não perde o iFood.
4. Feche no formato "como": "Começamos pelo cardápio digital próprio ou já integramos o balcão também?"`,
  },
  {
    key: "virada_como",
    title: "Virada \"Como\"",
    category: "Scripts de Venda",
    funnel_stage: "Oportunidade",
    channel: null,
    content_md: `Nunca pergunte SE quer fechar. Pergunte COMO.

- "Prefere começar essa semana ou só mês que vem?"
- "Faz mais sentido o cardápio digital primeiro ou já migrar a comanda também?"

Diante de "vou pensar", isole antes de responder:
- "O que especificamente você quer pensar melhor: o valor, o momento ou alguém que precisa ver junto?"
- Valor → volte ao custo da inação, sem desconto de cara.
- Momento → pergunte o período de menor movimento.
- Sócio → "O que ele prioriza?" e ajude a montar o argumento para ele.

Alerta: "vou pensar" sem retorno acima de 50% indica Ancoragem fraca.`,
  },
  {
    key: "pos_venda_7d",
    title: "Pós-venda 7d",
    category: "Pós-venda",
    funnel_stage: "Cliente",
    channel: "WhatsApp",
    content_md: `No fechamento: peça indicação na hora ("Conhece outro restaurante com o mesmo problema que você tinha?").

Follow-up de 7 dias após a implantação, para confirmar resultado (não para vender mais):
1. Começou a usar? Onde trava?
2. A equipe usa sem depender de você?
3. Qual o ganho até agora?

Registre a dor real do cliente (não o que ele comprou) como caso.
Peça indicação só se a implantação começou bem e o cliente demonstrou alívio. Com pendência de suporte, resolva primeiro.
Sinais de upsell: nova dor, operação crescendo, mais unidades ou canais, pedido de relatório.`,
  },
];

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Sistemas de gestão/PDV: o cliente entende valor e objeta migração. */
const PDV_SYSTEMS = ["saipos", "yogga", "colibri", "consumer", "f.rest", "frest"];
/** Delivery e cardápio digital: conversa de canal próprio e comissão. */
const DELIVERY_SYSTEMS = ["anota ai", "anotaai", "ifood", "menudino", "olaclick", "instadelivery", "goomer"];

export type SystemGroup = "pdv" | "delivery" | "manual" | "desconhecido";

export function systemGroup(currentSystem: string | null | undefined): SystemGroup {
  const s = norm(currentSystem).trim();
  if (!s || s === "a validar") return "manual";
  if (/planilha|manual|papel|caderno|nenhum/.test(s)) return "manual";
  if (PDV_SYSTEMS.some((k) => s.includes(k))) return "pdv";
  if (DELIVERY_SYSTEMS.some((k) => s.includes(k))) return "delivery";
  return "desconhecido";
}

export interface Recommendation {
  key: PlaybookKey;
  title: string;
  why: string;
  content_md: string;
  /** id do playbook salvo na org, quando existir (a versão editada pelo time vale mais que a padrão) */
  playbookId: string | null;
}

/**
 * Script recomendado para a conta: um pela etapa da venda e um battlecard pelo sistema atual.
 * Usa a versão salva na org (mesmo título) se houver; senão, o texto padrão.
 */
export function recommendScripts(
  a: Pick<Account, "status" | "current_system" | "persona">,
  saved: Pick<Playbook, "id" | "title" | "content_md">[],
): Recommendation[] {
  const out: { key: PlaybookKey; why: string }[] = [];
  const st = a.status;
  if (st === "fechado") out.push({ key: "pos_venda_7d", why: "Cliente fechado: pós-venda e indicação" });
  else if (st === "negociacao") out.push({ key: "virada_como", why: "Em negociação: fechar no formato \"como\"" });
  else if (st === "proposta_enviada" || st === "demo_realizada")
    out.push({ key: a.persona === "socio_financeiro" ? "ancoragem_ifood" : "virada_como", why: a.persona === "socio_financeiro" ? "Sócio financeiro decide por número: ancorar a dor" : "Proposta na mesa: conduzir a decisão" });
  else if (st === "discovery" || st === "agendado") out.push({ key: "tres_perguntas", why: "Diagnóstico: as 3 perguntas antes da solução" });
  else if (st !== "perdido") out.push({ key: "conexao_90s", why: "Primeiro contato: Conexão nos 90 segundos" });

  const g = systemGroup(a.current_system);
  if (g === "pdv") out.push({ key: "battle_pdv", why: `Usa ${a.current_system}: objeção de migração` });
  else if (g === "delivery") out.push({ key: "battle_delivery", why: `Usa ${a.current_system}: canal próprio e comissão` });
  else if (g === "manual" && st !== "fechado") out.push({ key: "ancoragem_ifood", why: "Sem sistema informado: fazer o cliente calcular a dor" });

  const seen = new Set<PlaybookKey>();
  return out
    .filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)))
    .map((r) => {
      const def = DEFAULT_PLAYBOOKS.find((p) => p.key === r.key)!;
      const mine = saved.find((p) => norm(p.title) === norm(def.title));
      return { key: r.key, title: def.title, why: r.why, content_md: mine?.content_md ?? def.content_md, playbookId: mine?.id ?? null };
    });
}

/** Playbooks padrão que ainda não existem na org (por título): carregar não duplica. */
export function missingDefaults(saved: Pick<Playbook, "title">[]): DefaultPlaybook[] {
  const have = new Set(saved.map((p) => norm(p.title)));
  return DEFAULT_PLAYBOOKS.filter((p) => !have.has(norm(p.title)));
}
