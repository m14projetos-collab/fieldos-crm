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

## Fase 2 — CRM, Pipeline e Rotas ⬜

- Tabela operacional (ordenada por próxima ação), Kanban (arrastar/clicar) e visão por região/bairro.
- Automações de etapa no Kanban: Proposta Enviada cria follow-up de cobrança e grava `proposal_sent_at`;
  Fechado grava `closed_at`, marca a conta e cria pós-venda 7 dias (em RPC, como o Quick Log).
- Rota do dia (data, turno, modo, KM) com visitas ordenadas; otimizador por vizinho mais próximo sobre lat/long
  das contas (geocodificação gratuita via Nominatim, com cache em `accounts`), KM e tempo total calculados.

Aceite: mover card atualiza conta e follow-up numa transação; otimizar rota reduz KM calculado (não estimado fixo);
nenhuma coluna de cliente duplicada em `routes`.

## Fase 3 — Copiloto CHAVE e Performance ⬜

- Qualificador ICP (5 critérios; < 3 = lead de nutrição) salvo em `accounts.icp_checklist`.
- Matriz de objeções e playbooks por persona (tabela `playbooks`, editável por org).
- Auditor CHAVE com IA: Edge Function chamando a API da Claude com o prompt de auditoria do Notion. Tem custo por
  uso; decidir limite mensal antes.
- Metas diárias/semanais/mensais com barras (lendo `vw_goal_progress`), Daily automática + check-in qualitativo,
  funil e conversão por persona (Recharts).

## Fase 4 — SaaS ⬜

- Convites e vários usuários por org; papel `manager` vê o time, `ae` vê o próprio.
- Parametrização por org em `organizations.settings`: bairros, sistemas concorrentes, segmentos, templates de WhatsApp, etapas.
- Importação CSV do Notion (CRM, Agenda, Pipeline, Follow-ups) com deduplicação.
- Cobrança e limites por plano.

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
