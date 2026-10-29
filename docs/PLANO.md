# FieldOS CRM — Plano por fases

Base: `arquitetura_crm_saas_e_prompt_claude.md` (schema v0 + super prompt), `workspace-comercial-takeat-notion.md`
(regras, fórmulas, Método CHAVE, cadência, ICP) e o protótipo HTML. O protótipo foi a referência de UX e dos
scripts; o schema v0 foi a base do banco, com as correções listadas no fim deste arquivo.

Legenda: ✅ feito e validado · 🟡 escrito, falta validar no ambiente real · ⬜ não iniciado

## Fase 0 — Fundação de dados ✅

Entregue: 6 migrations em `supabase/migrations/`, testes em `supabase/tests/`.

Critérios de aceite:
- ✅ Tabelas accounts, visits, routes, opportunities, follow_ups, goals, daily_logs, campaigns, playbooks com `org_id`.
- ✅ Dados cadastrais e geográficos só em `accounts`; nenhuma coluna "próximo passo" fora de `follow_ups`.
- ✅ RLS por `org_id` em todas as tabelas; usuário de outra org não lê nem escreve (testado).
- ✅ Uma visita não consegue apontar para conta de outra org (FK composta, testado).
- ✅ Score, próxima melhor ação, completude e funil calculados em view (`vw_accounts_enriched`), sem digitação.
- ✅ Metas com "realizado" calculado (`vw_goal_progress`), nunca digitado.
- ✅ Ações rápidas atômicas em RPC: `log_visit_outcome`, `complete_follow_up`, `create_lead`, `schedule_visit`.
- ✅ Aplicado no Supabase real (`tdvefdpnfglomxfafcib`, Postgres 17) em 2026-10-29: 11 tabelas com RLS, 13 policies,
  2 views, realtime em 4 tabelas.
- ✅ Security Advisor: corrigidos search_path mutável (9 funções) e funções executáveis por visitante sem login
  (migration 0006). Ficam 3 avisos intencionais: `current_org_id`, `org_today` e `create_organization` são
  SECURITY DEFINER chamáveis por usuário logado (o RLS e o onboarding dependem disso).

## Fase 1 — Comando "Hoje" + Quick Log + Gaveta 360º + Command Palette ✅ (modo demo) / 🟡 (Supabase)

Critérios de aceite:
- ✅ KPIs no topo: visitas hoje vs. meta, follow-ups (vencidos destacados), propostas em aberto + forecast ponderado, MRR fechado no mês.
- ✅ Próxima visita com endereço, bairro, sistema atual, persona e botões Check-in / Rota / WhatsApp pré-visita.
- ✅ Fila de follow-ups (atrasados primeiro) com WhatsApp do dia da cadência e "Feito" em 1 toque + escolha do próximo.
- ✅ Alertas de higiene: negociação parada > 7 dias, conta ativa sem próxima ação, venda sem MRR, cadastro incompleto.
- ✅ Quick Log: 1 toque no resultado + 1 em Confirmar atualiza visita, conta, pipeline e cria o próximo follow-up.
- ✅ Após o check-in a conta fica com exatamente 1 próxima ação.
- ✅ Conta em negociação ativa não pode ficar sem follow-up (bloqueado no banco e na UI, com mensagem clara).
- ✅ Gaveta 360º abre de qualquer lista sem recarregar: score, próxima melhor ação, completude, WhatsApp com script,
  dados editáveis (fonte única), calculadora de ancoragem que salva no card, oportunidades e histórico de visitas.
- ✅ Ctrl+K / Cmd+K: buscar restaurante (nome, bairro, sistema, segmento), criar lead, agendar visita, check-in, WhatsApp.
- ✅ Celular (390 px): sem rolagem lateral, navegação inferior e botão flutuante de check-in.
- ✅ UI otimista: a tela muda antes da resposta do servidor e desfaz se o servidor recusar.
- 🟡 Login por link mágico, onboarding da org e realtime: escritos, não testados contra um Supabase real.

## Fase 2 — CRM, Pipeline e Rotas ✅ (29/10/2026)

- `/crm`: Tabela (ordenável, cartões no celular), Kanban de Prospecção (status da conta), Kanban de Pipeline
  (oportunidades, valor e forecast ponderado por coluna, deals parados há 7+ dias em destaque) e Regiões (bairros
  com base, pipeline, MRR, conversão e contas sem próxima ação). Mover por arrastar (desktop) ou menu (celular).
- Migration 0009: `move_opportunity`, `create_opportunity` (no máximo 1 aberta por conta), `set_account_status`,
  `cancel_visit`, `reschedule_visit`, `save_route` (1 rota por vendedor/dia), `set_route_status`.
  Fechar exige MRR; perder exige motivo; cada movimento troca as pendentes por UMA próxima ação.
- `/rotas`: visitas do dia em ordem, otimização (vizinho mais próximo + 2-opt), distância por ruas via OSRM com
  fallback em linha reta × fator (rotulado na tela), horários recalculados, link do Google Maps com todas as
  paradas, geocodificação gratuita (OpenStreetMap, 1 pedido/s, validada pelo bairro), encaixe de contas com ação
  vencida perto da rota, e planejador de dia de campo por bairro (quantas visitas cabem sai da janela de horário).

Validado: 40+ cenários SQL locais, paridade TS (vitest), fluxo completo em produção dentro de transação revertida,
telas no navegador com API simulada. Não validado daqui: chamadas ao OSRM/OpenStreetMap (a rede do ambiente de
desenvolvimento bloqueia; no celular funcionam, e se falharem o app cai para linha reta).

## Fase 3 — Copiloto CHAVE e Performance ✅ (29/10/2026)

- `/chave`: ICP (5 perguntas; 3+ "não" = nutrição; prioridade sugerida pela calibragem do método) salvo em
  `accounts.icp_checklist`; personas com bom/mau fit e perguntas de Hipótese/Ancoragem; 7 objeções com pergunta de
  isolamento pronta; auditoria pelo checklist de aplicação (nota por etapa, sem palavra-chave) salva em
  `opportunities.chave_checklist`; prompt de auditoria com contexto do CRM para colar no Claude/ChatGPT;
  termômetro com as 4 métricas de alerta do método (sem alerta abaixo de 10 casos); playbooks editáveis.
- `/performance`: metas recorrentes (migration 0010: o realizado é do dia/semana/mês atual), ritmo por dia útil,
  Daily automática + nota/humor/impacto/aprendizado (`daily_logs`), funil cumulativo, atividade 14 dias,
  conversão por persona/segmento/bairro/sistema, motivos de perda e ciclo médio.
- Auditor com IA automático (Edge Function + API da Claude): **não feito**, depende de chave de API e limite de
  custo definidos pelo Michel. O prompt pronto cobre o uso manual sem custo.

## Upgrade v2.0 ✅ (29/10/2026)
- MRR em 1 clique (R$ 349/489/649 ou outro) em proposta/negociação sem valor: card do pipeline, Hoje e ficha.
- Nome do restaurante abre a ficha 360º em Hoje, Rotas e CHAVE.
- Funil: MQL = quente, score ≥ 40 ou morno com contato feito (decisão do Michel: o "morno" da importação não conta).
  SQL = Qualificado, Demo/Visita, Proposta ou Negociação (oportunidade ou status). A view `vw_accounts_enriched.funnel_stage`
  ainda usa a regra antiga; o app não lê essa coluna (calcula em `enrich.ts`).
- Rotas: geocodificação limpa o endereço (sem CEP/UF/loja) e cai para o CEP (AwesomeAPI/BrasilAPI); aviso quando paradas
  caem no mesmo ponto do bairro (as 16 visitas de 29/10 estavam todas no centro de Santa Cruz = 0 km); botão para localizar a base.
- CHAVE: 7 playbooks padrão em 1 clique (sem duplicar) e "Script recomendado" na ficha (etapa + sistema atual + persona).
- Integrações (/integracoes): WhatsApp link/Evolution/Z-API com modelos ({nome} {restaurante} {bairro} {sistema}),
  webhooks (organizations.settings), Google Maps/Waze por aparelho, CSV/JSON com prévia. Ações em massa no CRM.
- Migration 0011 (pg_net + gatilhos visit.checkin / proposal.sent / deal.won): testada local; aplicação em produção
  aguardando a confirmação do Michel no conector Supabase.
- Não validado: geocodificação e envio por API de WhatsApp com serviço real (rede bloqueada no ambiente de teste);
  disparo real do webhook; uso no celular.

## Fase 4 — SaaS ⬜

- Convites e vários usuários por org; papel `manager` vê o time, `ae` vê o próprio.
- Parametrização por org em `organizations.settings`: bairros, sistemas concorrentes, segmentos, templates de WhatsApp, etapas.
- Importação CSV do Notion (CRM, Agenda, Pipeline, Follow-ups) com deduplicação.
- Cobrança e limites por plano.
- SMTP próprio no Supabase Auth (ex.: Resend, gratuito até 3 mil/mês): o e-mail embutido do Supabase tem limite
  baixo por hora ("email rate limit exceeded") e não serve para vários usuários.

## Decisões e correções em relação ao material existente

1. **RLS sem policies no schema v0.** O v0 ligava RLS mas não criava nenhuma policy: no Supabase isso bloqueia tudo
   para o app. Agora há policies por `org_id` em todas as tabelas.
2. **View vazando dados entre empresas.** No Postgres uma view roda com as permissões do dono e ignora o RLS de quem
   consulta. As views agora usam `security_invoker = true` (testado: a org B não vê nada da A pela view).
3. **FK composta `(id, org_id)`.** Sem isso, um usuário poderia criar visita/follow-up apontando para conta de outra empresa.
4. **Enums em slug** (`proposta_enviada`, não `Proposta Enviada`; sem emoji no banco). Rótulos ficam no app e
   poderão ser personalizados por org.
5. **Score**: segue a fórmula do prompt (Fechado vale 5 em status, como "Outros"); o protótipo dava 20.
   "Oportunidade ativa" = qualquer oportunidade não perdida.
6. **Quick Log encerra as próximas ações pendentes da conta** e cria uma nova. É o que garante "uma única próxima ação".
7. **Agendar visita cria um follow-up canal visita**, então a visita aparece como próxima ação sem duplicar dados.
8. **Scripts de WhatsApp sem nomes fixos.** O protótipo tinha "Michel" e "R$ 3.200" fixos; agora vêm do usuário, da
   org e da ancoragem salva. Dias 30, 60 e 90 foram escritos a partir dos objetivos da Central de Cadência.
9. **Itens do protótipo não portados por serem simulados:** o auditor CHAVE (nota decidida por palavra-chave, com
   reescrita fixa) e o aviso fixo "economia de 24,6 km" do otimizador. Voltam nas Fases 2 e 3 com cálculo real.
10. **Calculadora de ancoragem com premissas visíveis e editáveis** (20% dos pedidos migráveis, 1 erro = 1 ticket).

## Limitações conhecidas da Fase 1

- O app carrega todos os dados da org no navegador (com paginação de 1000 em 1000). Bom até alguns milhares de
  contas; acima disso, mover listas para consultas paginadas.
- `npm audit` aponta vulnerabilidade no PostCSS embutido no Next 15 (afeta o build, não o app em produção).
  A correção oficial exige Next 16; mantido o 15 conforme o pedido.

## M14 OS (29/10/2026)
- Paleta M14 (bg #0B0F19, superfícies #111624/#151C2C, bordas #1E273B; Crimson #E11D48 ações, Gold #F59E0B check-in/horários, Emerald #10B981 WhatsApp/score alto/fechado) via variáveis em `globals.css`; ☀️ Daylight em `:root[data-theme="light"]`, salvo por aparelho.
- 5 abas oficiais (Hoje, CRM, Rotas, CHAVE, Performance); Integrações em seção secundária e no menu da conta.
- `components/crm/lead-controls.tsx`: etapa (pílulas, mesmas regras do funil via useMover), sistema atual, temperatura (🔥→☀️→❄️), MRR 349/489/649, WA, Check-in (cria visita não planejada se não houver), Ficha 360º.
- Hoje: 6 KPIs, próxima visita (ou próximo da fila) com controles, agenda com controles compactos, follow-ups e Radar de Governança.
- CRM: ⚡ Visão Rápida, Tabela Completa (temperatura e sistema inline), Pipeline & Prospecção, Regiões, Recuperação (+15d/+30d sem contato) & Onboarding pós-venda + perdidos.
- Ficha 360º: no desktop ≥1280px vira painel fixo à direita (não modal; o conteúdo encolhe via container queries); aba lateral reabre a última ficha.
- CHAVE: aba Ancoragem de dor (simulação sem lead; salva no card com lead). Rotas: "Otimizar ordem (Auto-Cluster)" + malha geográfica SVG. Performance: barras em gradiente e MRR por bairro.

## Integrações gratuitas (29/10/2026)
- `lib/domain/links.ts`: rascunho de e-mail em 1 clique (Gmail, Outlook.com/Hotmail, Microsoft 365, mailto), modelos com `advance_to` (a conta só avança, nunca volta), Google Agenda/Outlook por link, `.ics` (RFC 5545, lembrete 30 min), pesquisa rápida (Google, avaliações no Maps, iFood, Instagram, Drive, Meet).
- Ficha: 📧 E-mail, 📅 próxima visita/follow-up na agenda, 🔎 pesquisa. Cards (LeadControls): botão 📧 com o modelo da etapa. Hoje e Rotas: "Agenda (.ics)" do dia.
- Integrações: modelos de e-mail, links padrão ({link_agenda}, {link_proposta}, pasta do Drive), assinatura de agenda e receitas Make/n8n.
- Migration 0012: `calendar_feeds` (só hash do token), `rotate_calendar_feed()`, `calendar_feed(token)` (única função liberada ao anon) e e-mail no payload do webhook. Rota `/api/agenda/[token].ics`.
- Fora por decisão: ler/registrar e-mails do Gmail automaticamente exige OAuth com escopo restrito do Google (verificação + auditoria de segurança paga); fica para quando houver backend dedicado.
