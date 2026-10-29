-- ============================================================================
-- FieldOS CRM — 0010 Metas recorrentes: o realizado é do período ATUAL
-- Antes: uma meta "diária" válida por 1 ano somava o ano inteiro.
-- Agora: period_type define a janela (dia / semana seg-dom / mês) dentro da validade
-- [start_date, end_date]. Colunas antigas mantidas; period_start/period_end no fim.
-- ============================================================================
create or replace view public.vw_goal_progress
with (security_invoker = true)
as
with w as (
  select
    g.*,
    o.timezone as tz,
    greatest(g.start_date, case g.period_type
      when 'diaria' then public.org_today(g.org_id)
      when 'semanal' then date_trunc('week', public.org_today(g.org_id))::date
      else date_trunc('month', public.org_today(g.org_id))::date end) as p_start,
    least(g.end_date, case g.period_type
      when 'diaria' then public.org_today(g.org_id)
      when 'semanal' then date_trunc('week', public.org_today(g.org_id))::date + 6
      else (date_trunc('month', public.org_today(g.org_id)) + interval '1 month - 1 day')::date end) as p_end
  from public.goals g
  join public.organizations o on o.id = g.org_id
)
select
  w.id, w.org_id, w.owner_id, w.title, w.category, w.period_type, w.start_date, w.end_date,
  w.target_value, w.is_primary, w.created_at,
  coalesce(case w.category
    when 'visitas' then (
      select count(*) from public.visits v
      where v.org_id = w.org_id and v.status = 'realizada'
        and (w.owner_id is null or v.owner_id = w.owner_id)
        and (v.completed_at at time zone w.tz)::date between w.p_start and w.p_end)
    when 'demonstracoes' then (
      select count(*) from public.visits v
      where v.org_id = w.org_id and v.status = 'realizada' and v.visit_type = 'demonstracao'
        and (w.owner_id is null or v.owner_id = w.owner_id)
        and (v.completed_at at time zone w.tz)::date between w.p_start and w.p_end)
    when 'propostas' then (
      select count(*) from public.opportunities op
      where op.org_id = w.org_id and op.proposal_sent_at between w.p_start and w.p_end
        and (w.owner_id is null or op.owner_id = w.owner_id))
    when 'vendas' then (
      select count(*) from public.opportunities op
      where op.org_id = w.org_id and op.stage = 'fechado' and op.closed_at between w.p_start and w.p_end
        and (w.owner_id is null or op.owner_id = w.owner_id))
    when 'receita_mrr' then (
      select sum(op.mrr_value) from public.opportunities op
      where op.org_id = w.org_id and op.stage = 'fechado' and op.closed_at between w.p_start and w.p_end
        and (w.owner_id is null or op.owner_id = w.owner_id))
    when 'novos_leads' then (
      select count(*) from public.accounts ac
      where ac.org_id = w.org_id
        and (w.owner_id is null or ac.owner_id = w.owner_id)
        and (ac.created_at at time zone w.tz)::date between w.p_start and w.p_end)
  end, 0)::numeric(12, 2) as actual_value,
  w.p_start as period_start,
  w.p_end as period_end
from w;
