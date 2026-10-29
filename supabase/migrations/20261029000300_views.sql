-- ============================================================================
-- FieldOS CRM — 0003 Views calculadas (zero digitação manual)
-- security_invoker = true: a view respeita o RLS de quem consulta.
-- (Sem isso, uma view no Postgres roda com o dono e vaza dados entre orgs.)
-- As mesmas fórmulas existem em src/lib/domain/enrich.ts; os testes de
-- supabase/tests/ conferem que SQL e TS dão o mesmo resultado.
-- ============================================================================

-- Data "hoje" no fuso da org
create or replace function public.org_today(p_org uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select o.timezone from public.organizations o where o.id = p_org),
    'America/Sao_Paulo'))::date
$$;
grant execute on function public.org_today(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Contas enriquecidas: Score (0-100), Próxima Melhor Ação, Completude,
-- Próximo follow-up e Etapa do Funil
-- ---------------------------------------------------------------------------
create or replace view public.vw_accounts_enriched
with (security_invoker = true)
as
select
  a.*,
  coalesce(v.visits_done, 0)          as visits_done,
  coalesce(f.followups_total, 0)      as followups_total,
  f.next_followup_id,
  f.next_followup_date,
  f.next_followup_title,
  f.next_followup_channel,
  coalesce(o.opps_active, 0)          as opps_active,
  coalesce(o.mrr_open, 0)             as mrr_open,
  coalesce(o.mrr_closed, 0)           as mrr_closed,
  coalesce(o.has_sql_opp, false)      as has_sql_opp,
  -- Score Comercial
  least(100, greatest(0,
      (case a.priority when 'alta' then 20 when 'media' then 12 else 6 end)
    + (case a.interest_level when 'quente' then 25 when 'morno' then 15 else 5 end)
    + (case a.status
         when 'negociacao' then 20
         when 'proposta_enviada' then 18
         when 'demo_realizada' then 15
         when 'discovery' then 10
         else 5 end)
    + least(coalesce(v.visits_done, 0) * 5, 15)
    + least(coalesce(f.followups_total, 0) * 3, 12)
    + (case when coalesce(o.opps_active, 0) > 0 then 8 else 0 end)
    - (case
         when a.last_interaction_at is null then 10
         when now() - a.last_interaction_at > interval '30 days' then 15
         when now() - a.last_interaction_at > interval '15 days' then 8
         else 0 end)
  ))::int as commercial_score,
  -- Próxima Melhor Ação (primeira regra que bater)
  case
    when a.status = 'perdido' then 'recuperar_oportunidade'
    when a.loss_reason = 'contato_invalido' then 'encerrar_negociacao'
    when a.status = 'fechado' then 'pos_venda_indicacao'
    when a.interest_level = 'quente' then 'ligar_agora'
    when a.status = 'proposta_enviada' then 'cobrar_decisao'
    when a.status = 'negociacao' then 'enviar_proposta_final'
    when a.preferred_channel = 'visita' then 'fazer_visita'
    when a.preferred_channel = 'whatsapp' then 'enviar_whatsapp'
    when a.status = 'novo_lead' then 'ligar_conexao'
    when a.status = 'lead_importado' then 'whatsapp_dia_0'
    else 'ligar'
  end as next_best_action,
  -- Completude (primeiro campo faltante)
  case
    when coalesce(trim(a.phone), '') = '' and coalesce(trim(a.whatsapp), '') = '' then 'telefone'
    when coalesce(trim(a.region), '') = '' then 'regiao'
    when coalesce(trim(a.neighborhood), '') = '' then 'bairro'
    when f.next_followup_id is null and a.status not in ('fechado', 'perdido') then 'follow_up'
    else null
  end as missing_field,
  -- Etapa do funil (Mercado → Lead → MQL → SQL → Cliente)
  case
    when a.status = 'perdido' then 'perdido'
    when a.status = 'fechado' or coalesce(o.has_won, false) then 'cliente'
    when coalesce(o.has_sql_opp, false) then 'sql'
    when a.interest_level in ('quente', 'morno') then 'mql'
    else 'lead'
  end as funnel_stage
from public.accounts a
left join lateral (
  select count(*) as visits_done
  from public.visits vv
  where vv.account_id = a.id and vv.status = 'realizada'
) v on true
left join lateral (
  select
    count(*) as followups_total,
    (array_agg(ff.id order by ff.due_date, ff.created_at) filter (where ff.status = 'pendente'))[1] as next_followup_id,
    min(ff.due_date) filter (where ff.status = 'pendente') as next_followup_date,
    (array_agg(ff.title order by ff.due_date, ff.created_at) filter (where ff.status = 'pendente'))[1] as next_followup_title,
    (array_agg(ff.channel order by ff.due_date, ff.created_at) filter (where ff.status = 'pendente'))[1] as next_followup_channel
  from public.follow_ups ff
  where ff.account_id = a.id
) f on true
left join lateral (
  select
    count(*) filter (where oo.stage <> 'perdido') as opps_active,
    sum(oo.mrr_value) filter (where oo.stage not in ('perdido', 'fechado')) as mrr_open,
    sum(oo.mrr_value) filter (where oo.stage = 'fechado') as mrr_closed,
    bool_or(oo.stage in ('qualificado', 'demo_agendada', 'proposta_enviada', 'negociacao')) as has_sql_opp,
    bool_or(oo.stage = 'fechado') as has_won
  from public.opportunities oo
  where oo.account_id = a.id
) o on true;

-- ---------------------------------------------------------------------------
-- Progresso de metas: "realizado" calculado sobre os registros reais
-- ---------------------------------------------------------------------------
create or replace view public.vw_goal_progress
with (security_invoker = true)
as
select
  g.*,
  coalesce(case g.category
    when 'visitas' then (
      select count(*) from public.visits v
      where v.org_id = g.org_id and v.status = 'realizada'
        and (g.owner_id is null or v.owner_id = g.owner_id)
        and (v.completed_at at time zone o.timezone)::date between g.start_date and g.end_date)
    when 'demonstracoes' then (
      select count(*) from public.visits v
      where v.org_id = g.org_id and v.status = 'realizada' and v.visit_type = 'demonstracao'
        and (g.owner_id is null or v.owner_id = g.owner_id)
        and (v.completed_at at time zone o.timezone)::date between g.start_date and g.end_date)
    when 'propostas' then (
      select count(*) from public.opportunities op
      where op.org_id = g.org_id and op.proposal_sent_at between g.start_date and g.end_date
        and (g.owner_id is null or op.owner_id = g.owner_id))
    when 'vendas' then (
      select count(*) from public.opportunities op
      where op.org_id = g.org_id and op.stage = 'fechado' and op.closed_at between g.start_date and g.end_date
        and (g.owner_id is null or op.owner_id = g.owner_id))
    when 'receita_mrr' then (
      select sum(op.mrr_value) from public.opportunities op
      where op.org_id = g.org_id and op.stage = 'fechado' and op.closed_at between g.start_date and g.end_date
        and (g.owner_id is null or op.owner_id = g.owner_id))
    when 'novos_leads' then (
      select count(*) from public.accounts ac
      where ac.org_id = g.org_id
        and (g.owner_id is null or ac.owner_id = g.owner_id)
        and (ac.created_at at time zone o.timezone)::date between g.start_date and g.end_date)
  end, 0)::numeric(12, 2) as actual_value
from public.goals g
join public.organizations o on o.id = g.org_id;
