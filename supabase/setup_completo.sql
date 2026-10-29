-- FieldOS CRM: setup completo (concatena supabase/migrations/ em ordem). Rode UMA vez num projeto novo, no SQL Editor.

-- >>> supabase/migrations/20261029000100_core_schema.sql
-- ============================================================================
-- FieldOS CRM — 0001 Core schema (multi-tenant por org_id)
-- Base: arquitetura_crm_saas_e_prompt_claude.md (schema v0), com ajustes:
--   * valores de enum em slug ASCII (rótulos/emoji ficam no app, parametrizáveis)
--   * FKs compostas (id, org_id) impedem uma linha apontar para dado de outra org
--   * follow_ups é a ÚNICA fonte de próxima ação (sem "próximo passo" em outras tabelas)
--   * nenhum dado cadastral/geográfico fora de accounts
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Utilitário: updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Organizações (tenants)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
  niche       text not null default 'foodservice',
  plan_tier   text not null default 'free',
  timezone    text not null default 'America/Sao_Paulo',
  -- Parametrização por tenant (Fase 4: listas de bairros, sistemas, templates...)
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Perfis (1 usuário = 1 org nesta versão)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  full_name   text not null,
  role        text not null default 'ae' check (role in ('admin', 'manager', 'ae')),
  territory   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  unique (id, org_id)
);
create index profiles_org_idx on public.profiles(org_id);

-- ---------------------------------------------------------------------------
-- 3. Campanhas
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  channel     text not null,
  start_date  date,
  end_date    date,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (id, org_id)
);

-- ---------------------------------------------------------------------------
-- 4. Accounts — fonte única de dados cadastrais e geográficos
-- ---------------------------------------------------------------------------
create table public.accounts (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  owner_id              uuid references public.profiles(id) on delete set null,
  name                  text not null check (length(trim(name)) > 0),
  status                text not null default 'novo_lead' check (status in (
                          'lead_frio', 'novo_lead', 'lead_importado', 'a_validar',
                          'primeiro_contato', 'discovery', 'agendado', 'demo_realizada',
                          'proposta_enviada', 'negociacao', 'fechado', 'perdido')),
  phone                 text,
  whatsapp              text,
  email                 text,
  decision_maker_name   text,             -- Nome do dono/decisor
  internal_contact      text,             -- Gerente/contato no salão
  persona               text not null default 'dono_operacional' check (persona in (
                          'dono_operacional', 'socio_financeiro', 'gerente_contratado')),
  address               text,
  city                  text,
  region                text,
  neighborhood          text,
  latitude              numeric(10, 7),
  longitude             numeric(10, 7),
  segment               text,
  company_size          text,
  current_system        text,             -- Saipos, Yogga, Anota AI, iFood Gestor, Planilha / Manual...
  instagram_url         text,
  website_url           text,
  acquisition_source    text,             -- origem de aquisição (único campo de origem no CRM)
  priority              text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
  interest_level        text not null default 'morno' check (interest_level in ('frio', 'morno', 'quente')),
  preferred_channel     text not null default 'whatsapp' check (preferred_channel in (
                          'whatsapp', 'ligacao', 'visita', 'email', 'instagram', 'indicacao',
                          'evento', 'cliente_antigo', 'recuperacao')),
  last_channel_used     text,
  best_contact_time     text,
  first_contact_date    date,
  last_interaction_at   timestamptz,
  loss_reason           text,
  post_sale_phase       text check (post_sale_phase in ('onboarding', 'ativo', 'em_risco', 'expansao', 'churn')),
  cadence_day           integer not null default 0 check (cadence_day in (0, 2, 5, 7, 10, 15, 30, 60, 90)),
  icp_checklist         jsonb not null default '{}'::jsonb,   -- 5 critérios ICP (Fase 3)
  pain_inputs           jsonb not null default '{}'::jsonb,   -- entradas da Calculadora de Ancoragem
  estimated_monthly_pain_brl numeric(12, 2),                  -- resultado salvo da Ancoragem
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, org_id)
);
create index accounts_org_status_idx on public.accounts(org_id, status);
create index accounts_org_neighborhood_idx on public.accounts(org_id, neighborhood);
create trigger accounts_updated_at before update on public.accounts
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Rotas — estritamente logística (sem dados do cliente)
-- ---------------------------------------------------------------------------
create table public.routes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  owner_id        uuid references public.profiles(id) on delete set null,
  route_date      date not null,
  shift           text not null default 'dia_todo' check (shift in ('manha', 'tarde', 'noite', 'dia_todo')),
  work_mode       text not null default 'campo' check (work_mode in ('campo', 'home_office')),
  status          text not null default 'planejada' check (status in ('planejada', 'em_andamento', 'concluida', 'cancelada')),
  estimated_km    numeric(6, 1),
  logistics_notes text,
  created_at      timestamptz not null default now(),
  unique (id, org_id)
);
create index routes_org_date_idx on public.routes(org_id, route_date);

-- ---------------------------------------------------------------------------
-- 6. Visitas (Agenda) — lê endereço/bairro/sistema de accounts via relação
-- ---------------------------------------------------------------------------
create table public.visits (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  account_id        uuid not null,
  route_id          uuid,
  route_order       integer,
  owner_id          uuid references public.profiles(id) on delete set null,
  scheduled_at      timestamptz not null,
  duration_minutes  integer not null default 45 check (duration_minutes between 5 and 600),
  status            text not null default 'agendada' check (status in (
                      'agendada', 'em_andamento', 'realizada', 'cancelada', 'reagendada')),
  visit_type        text not null default 'primeiro_contato' check (visit_type in (
                      'primeiro_contato', 'demonstracao', 'proposta', 'retorno', 'fechamento', 'pos_venda')),
  outcome           text check (outcome in (
                      'interesse_confirmado', 'proposta_solicitada', 'retorno_necessario', 'sem_interesse', 'fechado')),
  completed_at      timestamptz,
  checkin_notes     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, org_id),
  foreign key (account_id, org_id) references public.accounts(id, org_id) on delete cascade,
  foreign key (route_id, org_id) references public.routes(id, org_id) on delete set null (route_id),
  -- Visita realizada sempre tem resultado (garante o Quick Log)
  check (status <> 'realizada' or outcome is not null)
);
create index visits_org_scheduled_idx on public.visits(org_id, scheduled_at);
create index visits_account_idx on public.visits(account_id);
create trigger visits_updated_at before update on public.visits
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Oportunidades (Pipeline) — fonte oficial de MRR e forecast
-- ---------------------------------------------------------------------------
create table public.opportunities (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  account_id          uuid not null,
  campaign_id         uuid,
  owner_id            uuid references public.profiles(id) on delete set null,
  title               text not null,
  stage               text not null default 'qualificado' check (stage in (
                        'lead', 'qualificado', 'demo_agendada', 'proposta_enviada', 'negociacao', 'fechado', 'perdido')),
  plan_name           text,
  mrr_value           numeric(12, 2) not null default 0 check (mrr_value >= 0),
  discount_pct        numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  probability         integer not null default 35 check (probability between 0 and 100),
  expected_close_date date,
  proposal_sent_at    date,
  closed_at           date,
  conversion_channel  text,             -- único campo de canal de conversão (consolida as 3 "origens")
  loss_category       text,
  loss_detail         text,
  chave_checklist     jsonb not null default '{}'::jsonb,
  stage_changed_at    timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, org_id),
  foreign key (account_id, org_id) references public.accounts(id, org_id) on delete cascade,
  foreign key (campaign_id, org_id) references public.campaigns(id, org_id) on delete set null (campaign_id),
  check (stage <> 'fechado' or closed_at is not null)
);
create index opportunities_org_stage_idx on public.opportunities(org_id, stage);
create index opportunities_account_idx on public.opportunities(account_id);
create trigger opportunities_updated_at before update on public.opportunities
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_opportunity_stage_changed()
returns trigger
language plpgsql
as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at := now();
  end if;
  return new;
end;
$$;
create trigger opportunities_stage_changed before update on public.opportunities
  for each row execute function public.tg_opportunity_stage_changed();

-- ---------------------------------------------------------------------------
-- 8. Follow-ups — ÚNICA fonte de próxima ação
-- ---------------------------------------------------------------------------
create table public.follow_ups (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  account_id      uuid not null,
  visit_id        uuid,
  opportunity_id  uuid,
  owner_id        uuid references public.profiles(id) on delete set null,
  title           text not null,
  due_date        date not null,
  status          text not null default 'pendente' check (status in ('pendente', 'concluido', 'sem_resposta', 'cancelado')),
  channel         text not null default 'whatsapp' check (channel in ('ligacao', 'whatsapp', 'email', 'visita', 'proposta')),
  priority        text not null default 'media' check (priority in ('alta', 'media', 'baixa')),
  cadence_step    integer check (cadence_step in (0, 2, 5, 7, 10, 15, 30, 60, 90)),
  completed_at    timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (id, org_id),
  foreign key (account_id, org_id) references public.accounts(id, org_id) on delete cascade,
  foreign key (visit_id, org_id) references public.visits(id, org_id) on delete set null (visit_id),
  foreign key (opportunity_id, org_id) references public.opportunities(id, org_id) on delete set null (opportunity_id),
  check ((status = 'pendente') = (completed_at is null))
);
create index follow_ups_org_due_idx on public.follow_ups(org_id, due_date) where status = 'pendente';
create index follow_ups_account_idx on public.follow_ups(account_id);

-- ---------------------------------------------------------------------------
-- 9. Daily — só o check-in qualitativo (números vêm de views)
-- ---------------------------------------------------------------------------
create table public.daily_logs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  log_date      date not null,
  day_score     integer check (day_score between 1 and 10),
  mood          text check (mood in ('otimo', 'bom', 'normal', 'cansativo', 'dificil')),
  day_impact    text,
  day_learning  text,
  created_at    timestamptz not null default now(),
  unique (org_id, owner_id, log_date)
);

-- ---------------------------------------------------------------------------
-- 10. Metas — "realizado" NUNCA é armazenado (vw_goal_progress calcula)
-- ---------------------------------------------------------------------------
create table public.goals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  owner_id      uuid references public.profiles(id) on delete cascade,  -- null = meta do time
  title         text not null,
  category      text not null check (category in (
                  'visitas', 'demonstracoes', 'propostas', 'vendas', 'receita_mrr', 'novos_leads')),
  period_type   text not null check (period_type in ('diaria', 'semanal', 'mensal')),
  start_date    date not null,
  end_date      date not null,
  target_value  numeric(12, 2) not null check (target_value > 0),
  is_primary    boolean not null default true,
  created_at    timestamptz not null default now(),
  check (end_date >= start_date)
);
create index goals_org_period_idx on public.goals(org_id, start_date, end_date);

-- ---------------------------------------------------------------------------
-- 11. Playbooks / Base de conhecimento
-- ---------------------------------------------------------------------------
create table public.playbooks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  title         text not null,
  category      text not null,
  funnel_stage  text,
  channel       text,
  content_md    text not null,
  ai_enabled    boolean not null default true,
  updated_at    timestamptz not null default now()
);
create trigger playbooks_updated_at before update on public.playbooks
  for each row execute function public.tg_set_updated_at();

-- >>> supabase/migrations/20261029000200_rls_multitenant.sql
-- ============================================================================
-- FieldOS CRM — 0002 Row-Level Security multi-tenant
-- Regra: um usuário autenticado só enxerga e escreve linhas da própria org.
-- O schema v0 ligava RLS sem nenhuma policy (resultado: tudo bloqueado).
-- ============================================================================

-- org do usuário logado. SECURITY DEFINER para ler profiles sem recursão de RLS.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.org_id from public.profiles p where p.id = auth.uid()
$$;

revoke all on function public.current_org_id() from public;
grant execute on function public.current_org_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Habilita RLS em todas as tabelas
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.campaigns     enable row level security;
alter table public.accounts      enable row level security;
alter table public.routes        enable row level security;
alter table public.visits        enable row level security;
alter table public.opportunities enable row level security;
alter table public.follow_ups    enable row level security;
alter table public.daily_logs    enable row level security;
alter table public.goals         enable row level security;
alter table public.playbooks     enable row level security;

-- ---------------------------------------------------------------------------
-- organizations / profiles
-- ---------------------------------------------------------------------------
create policy org_select on public.organizations
  for select to authenticated using (id = (select public.current_org_id()));
create policy org_update on public.organizations
  for update to authenticated
  using (id = (select public.current_org_id())
         and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (id = (select public.current_org_id()));
-- INSERT de organização só via função create_organization (abaixo).

create policy profiles_select on public.profiles
  for select to authenticated using (org_id = (select public.current_org_id()));
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and org_id = (select public.current_org_id()));

-- impede o próprio usuário de se promover a admin ou trocar de org
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and new.id = auth.uid() then
    if new.org_id is distinct from old.org_id then
      raise exception 'Não é permitido trocar de organização';
    end if;
    if new.role is distinct from old.role then
      raise exception 'Não é permitido alterar o próprio papel';
    end if;
  end if;
  return new;
end;
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ---------------------------------------------------------------------------
-- Tabelas de negócio: mesma policy por org_id (select/insert/update/delete)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'campaigns', 'accounts', 'routes', 'visits', 'opportunities',
    'follow_ups', 'daily_logs', 'goals', 'playbooks'
  ]
  loop
    execute format(
      'create policy %1$s_tenant_all on public.%1$I for all to authenticated
         using (org_id = (select public.current_org_id()))
         with check (org_id = (select public.current_org_id()))', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- org_id preenchido automaticamente no INSERT (o app não precisa enviar)
-- ---------------------------------------------------------------------------
create or replace function public.tg_fill_org_id()
returns trigger
language plpgsql
as $$
begin
  if new.org_id is null then
    new.org_id := public.current_org_id();
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'campaigns', 'accounts', 'routes', 'visits', 'opportunities',
    'follow_ups', 'daily_logs', 'goals', 'playbooks'
  ]
  loop
    execute format(
      'create trigger %1$s_fill_org before insert on public.%1$I
         for each row execute function public.tg_fill_org_id()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Onboarding: cria a org e o perfil admin do usuário logado
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_slug text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'Não autenticado';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'Usuário já pertence a uma organização';
  end if;

  insert into public.organizations (name, slug)
  values (trim(p_name), lower(trim(p_slug)))
  returning id into v_org;

  insert into public.profiles (id, org_id, full_name, role)
  values (v_uid, v_org, coalesce(nullif(trim(p_full_name), ''), 'Admin'), 'admin');

  return v_org;
end;
$$;

revoke all on function public.create_organization(text, text, text) from public;
grant execute on function public.create_organization(text, text, text) to authenticated;

-- >>> supabase/migrations/20261029000300_views.sql
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

-- >>> supabase/migrations/20261029000400_rpc_quick_actions.sql
-- ============================================================================
-- FieldOS CRM — 0004 Ações rápidas atômicas (RPC)
-- Todas são SECURITY INVOKER: rodam com o RLS do usuário logado.
-- Regras espelhadas em src/lib/domain/transitions.ts (modo demo + UI otimista).
-- ============================================================================

-- Ordem de avanço (status nunca regride por uma ação rápida)
create or replace function public.account_status_rank(p_status text)
returns int language sql immutable as $$
  select case p_status
    when 'perdido' then 0
    when 'lead_frio' then 0
    when 'novo_lead' then 1 when 'lead_importado' then 1 when 'a_validar' then 1
    when 'primeiro_contato' then 2
    when 'discovery' then 3
    when 'agendado' then 4
    when 'demo_realizada' then 5
    when 'proposta_enviada' then 6
    when 'negociacao' then 7
    when 'fechado' then 99
    else 0 end
$$;

create or replace function public.opp_stage_rank(p_stage text)
returns int language sql immutable as $$
  select case p_stage
    when 'perdido' then 0 when 'lead' then 1 when 'qualificado' then 2
    when 'demo_agendada' then 3 when 'proposta_enviada' then 4
    when 'negociacao' then 5 when 'fechado' then 99 else 0 end
$$;

create or replace function public.opp_stage_probability(p_stage text)
returns int language sql immutable as $$
  select case p_stage
    when 'lead' then 20 when 'qualificado' then 35 when 'demo_agendada' then 50
    when 'proposta_enviada' then 65 when 'negociacao' then 80
    when 'fechado' then 100 else 0 end
$$;

-- Próximo passo da Central de Cadência (0,2,5,7,10,15,30,60,90). null = fim.
create or replace function public.next_cadence_step(p_step int)
returns int language sql immutable as $$
  select min(s) from unnest(array[0, 2, 5, 7, 10, 15, 30, 60, 90]) s
  where s > coalesce(p_step, -1)
$$;

-- Conta "em negociação ativa": exige follow-up pendente
create or replace function public.account_is_active(p_status text)
returns boolean language sql immutable as $$
  select p_status in ('primeiro_contato', 'discovery', 'agendado', 'demo_realizada', 'proposta_enviada', 'negociacao')
$$;

-- ---------------------------------------------------------------------------
-- Quick Log de estacionamento: 1 chamada = visita + conta + pipeline + follow-up
-- ---------------------------------------------------------------------------
create or replace function public.log_visit_outcome(
  p_visit_id      uuid,
  p_outcome       text,
  p_next_in_days  int  default null,   -- null = padrão do resultado
  p_next_channel  text default null,   -- null = padrão do resultado
  p_notes         text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_visit    public.visits%rowtype;
  v_acc      public.accounts%rowtype;
  v_opp      public.opportunities%rowtype;
  v_today    date;
  v_status   text;
  v_interest text;
  v_stage    text;
  v_days     int;
  v_channel  text;
  v_title    text;
  v_priority text := 'alta';
  v_fu_id    uuid;
begin
  if p_outcome not in ('interesse_confirmado', 'proposta_solicitada', 'retorno_necessario', 'sem_interesse', 'fechado') then
    raise exception 'Resultado inválido: %', p_outcome using errcode = '22023';
  end if;

  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found then
    raise exception 'Visita não encontrada' using errcode = 'P0002';
  end if;
  if v_visit.status in ('realizada', 'cancelada') then
    raise exception 'Visita já está %', v_visit.status using errcode = '22023';
  end if;

  select * into v_acc from public.accounts where id = v_visit.account_id for update;
  v_today := public.org_today(v_acc.org_id);

  -- oportunidade aberta mais recente (se houver)
  select * into v_opp from public.opportunities
  where account_id = v_acc.id and stage not in ('fechado', 'perdido')
  order by updated_at desc limit 1
  for update;

  -- Regras por resultado ------------------------------------------------------
  v_status := v_acc.status;
  v_interest := v_acc.interest_level;
  v_stage := null;  -- null = não mexe no pipeline

  case p_outcome
    when 'interesse_confirmado' then
      if public.account_status_rank(v_acc.status) < public.account_status_rank('discovery') then v_status := 'discovery'; end if;
      v_interest := case v_acc.interest_level when 'frio' then 'morno' else 'quente' end;
      v_stage := 'qualificado';
      v_days := 2; v_channel := 'whatsapp';
      v_title := 'Retorno pós-visita: confirmar demonstração';
    when 'proposta_solicitada' then
      if public.account_status_rank(v_acc.status) < public.account_status_rank('demo_realizada') then v_status := 'demo_realizada'; end if;
      v_interest := 'quente';
      v_stage := 'demo_agendada';
      v_days := 1; v_channel := 'proposta';
      v_title := 'Enviar proposta solicitada na visita';
    when 'retorno_necessario' then
      if public.account_status_rank(v_acc.status) < public.account_status_rank('primeiro_contato') then v_status := 'primeiro_contato'; end if;
      v_days := 3; v_channel := 'whatsapp';
      v_title := 'Retorno combinado na visita';
      v_priority := 'media';
    when 'sem_interesse' then
      v_status := 'perdido';
      v_interest := 'frio';
      v_stage := 'perdido';
      v_days := 90; v_channel := 'whatsapp';
      v_title := 'Recuperação: nova abordagem (Central de Recuperação)';
      v_priority := 'baixa';
    when 'fechado' then
      v_status := 'fechado';
      v_stage := 'fechado';
      v_days := 7; v_channel := 'visita';
      v_title := 'Pós-venda 7 dias: confirmar resultado e pedir indicação';
  end case;

  v_days := coalesce(p_next_in_days, v_days);
  v_channel := coalesce(p_next_channel, v_channel);
  if v_days < 0 or v_days > 365 then
    raise exception 'Prazo do próximo follow-up inválido' using errcode = '22023';
  end if;

  -- 1) Visita
  update public.visits
     set status = 'realizada', outcome = p_outcome, completed_at = now(),
         checkin_notes = coalesce(nullif(trim(p_notes), ''), checkin_notes)
   where id = v_visit.id;

  -- 2) Conta
  update public.accounts
     set status = v_status,
         interest_level = v_interest,
         last_interaction_at = now(),
         last_channel_used = 'visita',
         first_contact_date = coalesce(first_contact_date, v_today),
         post_sale_phase = case when v_status = 'fechado' then coalesce(post_sale_phase, 'onboarding') else post_sale_phase end,
         loss_reason = case when v_status = 'perdido' then coalesce(loss_reason, 'sem_interesse_momento') else loss_reason end
   where id = v_acc.id;

  -- 3) Pipeline
  if v_stage = 'perdido' then
    update public.opportunities
       set stage = 'perdido', probability = 0,
           loss_category = coalesce(loss_category, 'sem_interesse')
     where account_id = v_acc.id and stage not in ('fechado', 'perdido');
  elsif v_stage is not null then
    if v_opp.id is null then
      insert into public.opportunities (org_id, account_id, owner_id, title, stage, probability, closed_at, conversion_channel)
      values (v_acc.org_id, v_acc.id, coalesce(v_visit.owner_id, v_acc.owner_id), v_acc.name, v_stage,
              public.opp_stage_probability(v_stage),
              case when v_stage = 'fechado' then v_today end, 'visita_presencial')
      returning * into v_opp;
    elsif public.opp_stage_rank(v_stage) > public.opp_stage_rank(v_opp.stage) then
      update public.opportunities
         set stage = v_stage,
             probability = greatest(probability, public.opp_stage_probability(v_stage)),
             closed_at = case when v_stage = 'fechado' then v_today else closed_at end
       where id = v_opp.id
      returning * into v_opp;
    end if;
  end if;

  -- 4) Follow-ups: a visita encerra as próximas ações pendentes e cria UMA nova
  update public.follow_ups
     set status = 'concluido', completed_at = now(),
         notes = coalesce(notes || E'\n', '') || 'Encerrado pelo check-in da visita'
   where account_id = v_acc.id and status = 'pendente';

  insert into public.follow_ups (org_id, account_id, visit_id, opportunity_id, owner_id, title, due_date, channel, priority)
  values (v_acc.org_id, v_acc.id, v_visit.id,
          case when v_stage = 'perdido' then null else v_opp.id end,
          coalesce(v_visit.owner_id, v_acc.owner_id),
          v_title, v_today + v_days, v_channel, v_priority)
  returning id into v_fu_id;

  return jsonb_build_object(
    'visit_id', v_visit.id,
    'account_id', v_acc.id,
    'account_status', v_status,
    'opportunity_id', case when v_stage = 'perdido' then null else v_opp.id end,
    'opportunity_stage', case when v_stage = 'perdido' then 'perdido' else v_opp.stage end,
    'follow_up_id', v_fu_id,
    'follow_up_due', v_today + v_days
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Concluir follow-up em 1 clique (+ próximo, obrigatório em conta ativa)
-- ---------------------------------------------------------------------------
create or replace function public.complete_follow_up(
  p_follow_up_id  uuid,
  p_result        text default 'concluido',  -- 'concluido' | 'sem_resposta'
  p_next_in_days  int  default null,         -- null = sem próximo
  p_next_channel  text default null,
  p_next_title    text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fu      public.follow_ups%rowtype;
  v_acc     public.accounts%rowtype;
  v_today   date;
  v_step    int;
  v_next_id uuid;
begin
  if p_result not in ('concluido', 'sem_resposta') then
    raise exception 'Resultado inválido: %', p_result using errcode = '22023';
  end if;

  select * into v_fu from public.follow_ups where id = p_follow_up_id for update;
  if not found then
    raise exception 'Follow-up não encontrado' using errcode = 'P0002';
  end if;
  if v_fu.status <> 'pendente' then
    raise exception 'Follow-up já encerrado' using errcode = '22023';
  end if;

  select * into v_acc from public.accounts where id = v_fu.account_id for update;
  v_today := public.org_today(v_acc.org_id);

  update public.follow_ups
     set status = p_result, completed_at = now()
   where id = v_fu.id;

  update public.accounts
     set last_channel_used = v_fu.channel,
         last_interaction_at = case when p_result = 'concluido' then now() else last_interaction_at end,
         first_contact_date = coalesce(first_contact_date, v_today),
         status = case when p_result = 'concluido' and status in ('novo_lead', 'lead_importado', 'a_validar', 'lead_frio')
                       then 'primeiro_contato' else status end
   where id = v_acc.id
  returning * into v_acc;

  if p_next_in_days is not null then
    if p_next_in_days < 0 or p_next_in_days > 365 then
      raise exception 'Prazo do próximo follow-up inválido' using errcode = '22023';
    end if;
    v_step := case when v_fu.cadence_step is not null then public.next_cadence_step(v_fu.cadence_step) end;

    insert into public.follow_ups (org_id, account_id, opportunity_id, owner_id, title, due_date, channel, priority, cadence_step)
    values (v_fu.org_id, v_fu.account_id, v_fu.opportunity_id, v_fu.owner_id,
            coalesce(nullif(trim(p_next_title), ''),
                     case when v_step is not null then 'Cadência Dia ' || v_step else 'Próximo contato' end),
            v_today + p_next_in_days,
            coalesce(p_next_channel, v_fu.channel),
            v_fu.priority, v_step)
    returning id into v_next_id;

    if v_step is not null then
      update public.accounts set cadence_day = v_step where id = v_acc.id;
    end if;
  end if;

  -- Regra de ouro: conta em negociação ativa nunca fica sem próxima ação
  if public.account_is_active(v_acc.status)
     and not exists (select 1 from public.follow_ups where account_id = v_acc.id and status = 'pendente') then
    raise exception 'Conta em negociação ativa precisa de um próximo follow-up'
      using errcode = 'P0001', hint = 'NEXT_FOLLOWUP_REQUIRED';
  end if;

  return jsonb_build_object('follow_up_id', v_fu.id, 'next_follow_up_id', v_next_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Novo lead: conta + follow-up Dia 0 da cadência (próxima ação já nasce)
-- ---------------------------------------------------------------------------
create or replace function public.create_lead(
  p_name            text,
  p_whatsapp        text default null,
  p_neighborhood    text default null,
  p_current_system  text default null,
  p_segment         text default null,
  p_region          text default null,
  p_id              uuid default null   -- id gerado no cliente (UI otimista)
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_acc uuid;
begin
  if v_org is null then
    raise exception 'Usuário sem organização' using errcode = '42501';
  end if;

  insert into public.accounts (id, org_id, owner_id, name, whatsapp, neighborhood, current_system, segment, region, status)
  values (coalesce(p_id, gen_random_uuid()), v_org, auth.uid(), trim(p_name), nullif(trim(p_whatsapp), ''), nullif(trim(p_neighborhood), ''),
          nullif(trim(p_current_system), ''), nullif(trim(p_segment), ''), nullif(trim(p_region), ''), 'novo_lead')
  returning id into v_acc;

  insert into public.follow_ups (org_id, account_id, owner_id, title, due_date, channel, priority, cadence_step)
  values (v_org, v_acc, auth.uid(), 'Cadência Dia 0: primeiro contato', public.org_today(v_org), 'whatsapp', 'alta', 0);

  return v_acc;
end;
$$;

-- ---------------------------------------------------------------------------
-- Agendar visita: cria a visita e a próxima ação (follow-up canal visita)
-- ---------------------------------------------------------------------------
create or replace function public.schedule_visit(
  p_account_id    uuid,
  p_scheduled_at  timestamptz,
  p_visit_type    text default 'primeiro_contato',
  p_duration      int default 45,
  p_id            uuid default null   -- id gerado no cliente (UI otimista)
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_acc   public.accounts%rowtype;
  v_visit uuid;
  v_tz    text;
begin
  select * into v_acc from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Conta não encontrada' using errcode = 'P0002';
  end if;
  select timezone into v_tz from public.organizations where id = v_acc.org_id;

  insert into public.visits (id, org_id, account_id, owner_id, scheduled_at, visit_type, duration_minutes)
  values (coalesce(p_id, gen_random_uuid()), v_acc.org_id, v_acc.id, coalesce(auth.uid(), v_acc.owner_id), p_scheduled_at, p_visit_type, p_duration)
  returning id into v_visit;

  insert into public.follow_ups (org_id, account_id, visit_id, owner_id, title, due_date, channel, priority)
  values (v_acc.org_id, v_acc.id, v_visit, coalesce(auth.uid(), v_acc.owner_id),
          'Visita agendada', (p_scheduled_at at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date, 'visita', 'alta');

  update public.accounts
     set status = case when public.account_status_rank(status) < public.account_status_rank('agendado')
                        and status not in ('perdido') then 'agendado'
                       when status = 'perdido' then 'agendado'
                       else status end
   where id = v_acc.id;

  return v_visit;
end;
$$;

grant execute on function public.log_visit_outcome(uuid, text, int, text, text) to authenticated;
grant execute on function public.complete_follow_up(uuid, text, int, text, text) to authenticated;
grant execute on function public.create_lead(text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.schedule_visit(uuid, timestamptz, text, int, uuid) to authenticated;

-- >>> supabase/migrations/20261029000500_realtime.sql
-- ============================================================================
-- FieldOS CRM — 0005 Realtime: o app invalida o cache quando algo muda
-- (o RLS continua valendo para as mensagens de realtime)
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.accounts, public.visits, public.opportunities, public.follow_ups;
  end if;
end;
$$;

-- >>> supabase/migrations/20261029000600_hardening.sql
-- FieldOS CRM — 0006 Endurecimento (achados do Security Advisor do Supabase)
--
-- 1) search_path fixo em todas as funções (lint 0011). Os corpos já usam nomes
--    qualificados (public.*, auth.*) e só funções de pg_catalog, então '' é seguro.
-- 2) O papel anon não executa nenhuma função do app (lint 0028). No Supabase o anon
--    recebe EXECUTE por default privileges, por isso "revoke from public" não basta.
--    authenticated continua executando current_org_id/org_today (usadas no RLS e nas
--    views) e create_organization (onboarding): os avisos 0029 dessas três são intencionais.
-- 3) Índices cobrindo as FKs (lint 0001) para deletes em cascata e joins por conta.

alter function public.tg_set_updated_at()            set search_path = '';
alter function public.tg_opportunity_stage_changed() set search_path = '';
alter function public.tg_profiles_guard()            set search_path = '';
alter function public.tg_fill_org_id()               set search_path = '';
alter function public.account_status_rank(text)      set search_path = '';
alter function public.opp_stage_rank(text)           set search_path = '';
alter function public.opp_stage_probability(text)    set search_path = '';
alter function public.next_cadence_step(int)         set search_path = '';
alter function public.account_is_active(text)        set search_path = '';

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', f);
    end if;
  end loop;
end;
$$;

-- Funções criadas depois desta migration também não vão para o anon
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    alter default privileges in schema public revoke execute on functions from anon;
    alter default privileges in schema public revoke execute on functions from public;
  end if;
end;
$$;

-- Garante as permissões que o app usa (idempotente)
grant execute on function public.current_org_id()                                       to authenticated;
grant execute on function public.org_today(uuid)                                        to authenticated;
grant execute on function public.create_organization(text, text, text)                  to authenticated;
grant execute on function public.log_visit_outcome(uuid, text, int, text, text)         to authenticated;
grant execute on function public.complete_follow_up(uuid, text, int, text, text)        to authenticated;
grant execute on function public.create_lead(text, text, text, text, text, text, uuid)  to authenticated;
grant execute on function public.schedule_visit(uuid, timestamptz, text, int, uuid)     to authenticated;
grant execute on function public.account_status_rank(text)   to authenticated;
grant execute on function public.opp_stage_rank(text)        to authenticated;
grant execute on function public.opp_stage_probability(text) to authenticated;
grant execute on function public.next_cadence_step(int)      to authenticated;
grant execute on function public.account_is_active(text)     to authenticated;

-- Índices das FKs
create index if not exists accounts_owner_idx            on public.accounts(owner_id);
create index if not exists campaigns_org_idx             on public.campaigns(org_id);
create index if not exists daily_logs_owner_idx          on public.daily_logs(owner_id);
create index if not exists follow_ups_account_org_idx    on public.follow_ups(account_id, org_id);
create index if not exists follow_ups_opportunity_org_idx on public.follow_ups(opportunity_id, org_id);
create index if not exists follow_ups_visit_org_idx      on public.follow_ups(visit_id, org_id);
create index if not exists follow_ups_owner_idx          on public.follow_ups(owner_id);
create index if not exists goals_owner_idx               on public.goals(owner_id);
create index if not exists opportunities_account_org_idx on public.opportunities(account_id, org_id);
create index if not exists opportunities_campaign_org_idx on public.opportunities(campaign_id, org_id);
create index if not exists opportunities_owner_idx       on public.opportunities(owner_id);
create index if not exists playbooks_org_idx             on public.playbooks(org_id);
create index if not exists routes_owner_idx              on public.routes(owner_id);
create index if not exists visits_account_org_idx        on public.visits(account_id, org_id);
create index if not exists visits_owner_idx              on public.visits(owner_id);
create index if not exists visits_route_org_idx          on public.visits(route_id, org_id);

-- >>> supabase/migrations/20261029000700_org_invites.sql
-- FieldOS CRM — 0007 Convites por e-mail
-- O admin cadastra e-mails da equipe. Quando a pessoa entra pela primeira vez com esse e-mail,
-- accept_invite() cria o perfil dela na org do convite (em vez da tela "criar organização").

create table public.org_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  email       text not null check (email = lower(trim(email)) and email like '%_@_%'),
  full_name   text,
  role        text not null default 'ae' check (role in ('admin', 'manager', 'ae')),
  invited_by  uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (org_id, email)
);
create index org_invites_email_idx on public.org_invites(email) where accepted_at is null;
create index org_invites_invited_by_idx on public.org_invites(invited_by);

alter table public.org_invites enable row level security;

-- Só admin da org vê e gerencia os convites dela
create policy org_invites_admin_all on public.org_invites
  for all to authenticated
  using (org_id = (select public.current_org_id())
         and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'))
  with check (org_id = (select public.current_org_id())
         and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

create trigger org_invites_fill_org before insert on public.org_invites
  for each row execute function public.tg_fill_org_id();

-- Usuário logado e sem perfil: entra na org do convite pendente do próprio e-mail.
-- Retorna o org_id ou null se não houver convite.
create or replace function public.accept_invite()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_inv   public.org_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'Não autenticado';
  end if;
  if exists (select 1 from public.profiles where id = v_uid) then
    return (select org_id from public.profiles where id = v_uid);
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;
  if v_email is null then
    return null;
  end if;

  select * into v_inv from public.org_invites
   where email = v_email and accepted_at is null
   order by created_at
   limit 1
   for update;
  if not found then
    return null;
  end if;

  insert into public.profiles (id, org_id, full_name, role)
  values (v_uid, v_inv.org_id, coalesce(nullif(trim(v_inv.full_name), ''), split_part(v_email, '@', 1)), v_inv.role);

  update public.org_invites set accepted_at = now() where id = v_inv.id;
  return v_inv.org_id;
end;
$$;

revoke all on function public.accept_invite() from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.accept_invite() from anon;
  end if;
end $$;
grant execute on function public.accept_invite() to authenticated;

-- >>> supabase/migrations/20261029000800_anon_tables.sql
-- FieldOS CRM — 0008 Visitante sem login (anon) sem acesso às tabelas e views.
-- O RLS já devolvia zero linhas para o anon (as policies são "to authenticated"); isto fecha a porta
-- também no nível de permissão, como segunda camada.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on sequences from anon';
  end if;
end;
$$;

-- >>> supabase/migrations/20261029000900_pipeline_routes.sql
-- ============================================================================
-- FieldOS CRM — 0009 Fase 2: Pipeline (Kanban), status da conta e Rotas
-- Tudo aditivo: nenhuma coluna removida, nenhuma regra antiga alterada.
-- Regras espelhadas em src/lib/domain/pipeline.ts (modo demo + UI otimista).
-- ============================================================================

-- Rotas: tempo total calculado e origem da distância (ruas x linha reta)
alter table public.routes add column if not exists estimated_minutes integer check (estimated_minutes >= 0);
alter table public.routes add column if not exists distance_source text check (distance_source in ('ruas', 'linha_reta'));
alter table public.routes add column if not exists start_time time;

-- Precisão da geocodificação (endereço completo, rua ou só o bairro)
alter table public.accounts add column if not exists geo_precision text check (geo_precision in ('endereco', 'rua', 'bairro'));

-- Uma rota por vendedor por dia (evita rota duplicada)
create unique index if not exists routes_owner_date_uidx on public.routes(org_id, owner_id, route_date)
  where status <> 'cancelada';

-- ---------------------------------------------------------------------------
-- Helper: troca as próximas ações pendentes da conta por UMA nova
-- ---------------------------------------------------------------------------
create or replace function public.fu_set_next(
  p_account_id uuid, p_opp_id uuid, p_title text, p_due date, p_channel text, p_priority text, p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_acc public.accounts%rowtype;
  v_id  uuid;
begin
  select * into v_acc from public.accounts where id = p_account_id;
  update public.follow_ups
     set status = 'cancelado', completed_at = now(),
         notes = coalesce(notes || E'\n', '') || 'Substituído: ' || p_reason
   where account_id = p_account_id and status = 'pendente';
  insert into public.follow_ups (org_id, account_id, opportunity_id, owner_id, title, due_date, channel, priority)
  values (v_acc.org_id, v_acc.id, p_opp_id, coalesce(auth.uid(), v_acc.owner_id), p_title, p_due, p_channel, p_priority)
  returning id into v_id;
  return v_id;
end;
$$;

-- Garante uma próxima ação em conta ativa (sem mexer se já existe)
create or replace function public.fu_ensure_next(
  p_account_id uuid, p_opp_id uuid, p_title text, p_due date, p_channel text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_acc public.accounts%rowtype;
begin
  select * into v_acc from public.accounts where id = p_account_id;
  if public.account_is_active(v_acc.status)
     and not exists (select 1 from public.follow_ups where account_id = p_account_id and status = 'pendente') then
    insert into public.follow_ups (org_id, account_id, opportunity_id, owner_id, title, due_date, channel, priority)
    values (v_acc.org_id, v_acc.id, p_opp_id, coalesce(auth.uid(), v_acc.owner_id), p_title, p_due, p_channel, 'alta');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mover oportunidade no Kanban (automações de etapa numa transação)
-- ---------------------------------------------------------------------------
create or replace function public.move_opportunity(
  p_opp_id        uuid,
  p_stage         text,
  p_mrr           numeric default null,
  p_loss_category text default null,
  p_loss_detail   text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_opp    public.opportunities%rowtype;
  v_acc    public.accounts%rowtype;
  v_today  date;
  v_status text;
  v_mrr    numeric;
begin
  if p_stage not in ('lead', 'qualificado', 'demo_agendada', 'proposta_enviada', 'negociacao', 'fechado', 'perdido') then
    raise exception 'Etapa inválida: %', p_stage using errcode = '22023';
  end if;
  select * into v_opp from public.opportunities where id = p_opp_id for update;
  if not found then
    raise exception 'Oportunidade não encontrada' using errcode = 'P0002';
  end if;
  select * into v_acc from public.accounts where id = v_opp.account_id for update;
  v_today := public.org_today(v_acc.org_id);
  v_mrr := coalesce(p_mrr, v_opp.mrr_value);
  if v_mrr < 0 then
    raise exception 'MRR inválido' using errcode = '22023';
  end if;

  if p_stage = 'fechado' and v_mrr <= 0 then
    raise exception 'Informe o MRR (valor mensal) para fechar a venda'
      using errcode = 'P0001', hint = 'MRR_REQUIRED';
  end if;
  if p_stage = 'perdido' and nullif(trim(p_loss_category), '') is null then
    raise exception 'Informe o motivo da perda'
      using errcode = 'P0001', hint = 'LOSS_REASON_REQUIRED';
  end if;

  update public.opportunities
     set stage = p_stage,
         mrr_value = v_mrr,
         probability = public.opp_stage_probability(p_stage),
         proposal_sent_at = case when p_stage in ('proposta_enviada', 'negociacao', 'fechado')
                                 then coalesce(proposal_sent_at, case when p_stage = 'proposta_enviada' then v_today end)
                                 else proposal_sent_at end,
         closed_at = case when p_stage = 'fechado' then coalesce(closed_at, v_today) else null end,
         loss_category = case when p_stage = 'perdido' then trim(p_loss_category) else null end,
         loss_detail = case when p_stage = 'perdido' then nullif(trim(p_loss_detail), '') else null end
   where id = v_opp.id
  returning * into v_opp;

  -- Conta acompanha o pipeline (nunca regride por movimento de etapa aberta)
  v_status := case p_stage
    when 'fechado' then 'fechado'
    when 'perdido' then case when exists (
        select 1 from public.opportunities o
        where o.account_id = v_acc.id and o.id <> v_opp.id and o.stage not in ('fechado', 'perdido'))
      then v_acc.status else 'perdido' end
    when 'negociacao' then 'negociacao'
    when 'proposta_enviada' then 'proposta_enviada'
    when 'demo_agendada' then 'demo_realizada'
    when 'qualificado' then 'discovery'
    else 'primeiro_contato' end;
  if p_stage not in ('fechado', 'perdido')
     and v_acc.status not in ('perdido', 'fechado')
     and public.account_status_rank(v_status) < public.account_status_rank(v_acc.status) then
    v_status := v_acc.status;
  end if;
  -- cliente continua cliente (upsell aberto ou perdido não rebaixa a conta)
  if v_acc.status = 'fechado' then
    v_status := 'fechado';
  end if;

  update public.accounts
     set status = v_status,
         interest_level = case when p_stage in ('proposta_enviada', 'negociacao', 'fechado') then 'quente' else interest_level end,
         post_sale_phase = case when v_status = 'fechado' then coalesce(post_sale_phase, 'onboarding') else post_sale_phase end,
         loss_reason = case when v_status = 'perdido' then trim(p_loss_category) else loss_reason end
   where id = v_acc.id;

  -- Próxima ação (follow-ups continuam sendo a única fonte)
  case p_stage
    when 'proposta_enviada' then
      perform public.fu_set_next(v_acc.id, v_opp.id, 'Cobrar decisão da proposta (Virada: perguntar "como", não "se")',
                                 v_today + 2, 'whatsapp', 'alta', 'proposta enviada');
    when 'negociacao' then
      perform public.fu_set_next(v_acc.id, v_opp.id, 'Negociação: alinhar condições e data de início',
                                 v_today + 2, 'ligacao', 'alta', 'negociação');
    when 'fechado' then
      perform public.fu_set_next(v_acc.id, v_opp.id, 'Pós-venda 7 dias: confirmar resultado e pedir indicação',
                                 v_today + 7, 'visita', 'alta', 'venda fechada');
    when 'perdido' then
      if v_status = 'perdido' then
        perform public.fu_set_next(v_acc.id, null, 'Recuperação: nova abordagem (motivo: ' || trim(p_loss_category) || ')',
                                   v_today + 90, 'whatsapp', 'baixa', 'oportunidade perdida');
      end if;
    when 'demo_agendada' then
      perform public.fu_ensure_next(v_acc.id, v_opp.id, 'Confirmar demonstração', v_today + 1, 'whatsapp');
    else
      perform public.fu_ensure_next(v_acc.id, v_opp.id, 'Próximo contato da oportunidade', v_today + 2, 'whatsapp');
  end case;

  return jsonb_build_object('opportunity_id', v_opp.id, 'stage', v_opp.stage, 'account_status', v_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Nova oportunidade (no máximo UMA aberta por conta: sem pipeline duplicado)
-- ---------------------------------------------------------------------------
create or replace function public.create_opportunity(
  p_account_id uuid,
  p_stage      text default 'qualificado',
  p_mrr        numeric default 0,
  p_plan_name  text default null,
  p_title      text default null,
  p_id         uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_acc public.accounts%rowtype;
  v_id  uuid;
begin
  if p_stage in ('fechado', 'perdido') then
    raise exception 'Crie a oportunidade numa etapa aberta e depois mova' using errcode = '22023';
  end if;
  select * into v_acc from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Conta não encontrada' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.opportunities where account_id = v_acc.id and stage not in ('fechado', 'perdido')) then
    raise exception 'Esta conta já tem uma oportunidade aberta' using errcode = 'P0001', hint = 'OPEN_OPP_EXISTS';
  end if;

  insert into public.opportunities (id, org_id, account_id, owner_id, title, stage, plan_name, mrr_value, probability, conversion_channel)
  values (coalesce(p_id, gen_random_uuid()), v_acc.org_id, v_acc.id, coalesce(auth.uid(), v_acc.owner_id),
          coalesce(nullif(trim(p_title), ''), v_acc.name), 'lead', nullif(trim(p_plan_name), ''),
          greatest(coalesce(p_mrr, 0), 0), public.opp_stage_probability('lead'), coalesce(v_acc.last_channel_used, 'prospeccao_ativa'))
  returning id into v_id;

  perform public.move_opportunity(v_id, p_stage, null, null, null);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mover conta no Kanban de prospecção (status da conta)
-- Etapas a partir de Demo Realizada passam pelo pipeline (oportunidade).
-- ---------------------------------------------------------------------------
create or replace function public.set_account_status(
  p_account_id    uuid,
  p_status        text,
  p_mrr           numeric default null,
  p_loss_category text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_acc   public.accounts%rowtype;
  v_opp   uuid;
  v_today date;
  v_stage text;
begin
  if p_status not in ('lead_frio', 'novo_lead', 'lead_importado', 'a_validar', 'primeiro_contato', 'discovery', 'agendado',
                      'demo_realizada', 'proposta_enviada', 'negociacao', 'fechado', 'perdido') then
    raise exception 'Status inválido: %', p_status using errcode = '22023';
  end if;
  select * into v_acc from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'Conta não encontrada' using errcode = 'P0002';
  end if;
  v_today := public.org_today(v_acc.org_id);

  select id into v_opp from public.opportunities
   where account_id = v_acc.id and stage not in ('fechado', 'perdido')
   order by updated_at desc limit 1;

  v_stage := case p_status
    when 'demo_realizada' then 'demo_agendada'
    when 'proposta_enviada' then 'proposta_enviada'
    when 'negociacao' then 'negociacao'
    when 'fechado' then 'fechado' end;

  if v_stage is not null then
    if v_opp is null then
      v_opp := public.create_opportunity(v_acc.id, case when p_status = 'fechado' then 'negociacao' else v_stage end,
                                         p_mrr, null, null, null);
    end if;
    perform public.move_opportunity(v_opp, v_stage, p_mrr, null, null);
    -- a conta pode estar "à frente" do pipeline (rank); aqui o usuário escolheu o status
    update public.accounts set status = p_status where id = v_acc.id;
    return jsonb_build_object('account_status', p_status, 'opportunity_id', v_opp);
  end if;

  if p_status = 'perdido' then
    if nullif(trim(p_loss_category), '') is null then
      raise exception 'Informe o motivo da perda' using errcode = 'P0001', hint = 'LOSS_REASON_REQUIRED';
    end if;
    if v_opp is not null then
      update public.opportunities
         set stage = 'perdido', probability = 0, closed_at = null, loss_category = trim(p_loss_category)
       where account_id = v_acc.id and stage not in ('fechado', 'perdido');
    end if;
    update public.accounts set status = 'perdido', loss_reason = trim(p_loss_category) where id = v_acc.id;
    perform public.fu_set_next(v_acc.id, null, 'Recuperação: nova abordagem (motivo: ' || trim(p_loss_category) || ')',
                               v_today + 90, 'whatsapp', 'baixa', 'conta perdida');
    return jsonb_build_object('account_status', 'perdido');
  end if;

  -- Etapas de prospecção: não pode haver negociação aberta "escondida" atrás da conta
  if v_opp is not null then
    raise exception 'Esta conta tem uma oportunidade aberta no pipeline: mova por lá ou marque como perdida'
      using errcode = 'P0001', hint = 'OPEN_OPP_EXISTS';
  end if;
  -- Só o status; conta ativa ganha próxima ação se não tiver
  update public.accounts
     set status = p_status,
         loss_reason = case when v_acc.status = 'perdido' then null else loss_reason end
   where id = v_acc.id;
  perform public.fu_ensure_next(v_acc.id, null,
    case p_status when 'agendado' then 'Agendar a visita combinada' when 'discovery' then 'Diagnóstico: 3 perguntas da Hipótese'
                  else 'Próximo contato' end,
    v_today + case p_status when 'agendado' then 1 else 2 end,
    case p_status when 'agendado' then 'visita' when 'discovery' then 'ligacao' else 'whatsapp' end);
  return jsonb_build_object('account_status', p_status, 'opportunity_id', v_opp);
end;
$$;

-- ---------------------------------------------------------------------------
-- Visitas: cancelar e reagendar (mantém o follow-up de visita coerente)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_visit(p_visit_id uuid, p_reason text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_visit public.visits%rowtype;
  v_acc   public.accounts%rowtype;
begin
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found then
    raise exception 'Visita não encontrada' using errcode = 'P0002';
  end if;
  if v_visit.status in ('realizada', 'cancelada') then
    raise exception 'Visita já está %', v_visit.status using errcode = '22023';
  end if;
  update public.visits
     set status = 'cancelada', route_id = null, route_order = null,
         checkin_notes = coalesce(nullif(trim(p_reason), ''), checkin_notes)
   where id = v_visit.id;
  update public.follow_ups set status = 'cancelado', completed_at = now(),
         notes = coalesce(notes || E'\n', '') || 'Visita cancelada'
   where visit_id = v_visit.id and status = 'pendente';
  select * into v_acc from public.accounts where id = v_visit.account_id;
  perform public.fu_ensure_next(v_acc.id, null, 'Reagendar visita cancelada', public.org_today(v_acc.org_id) + 1, 'whatsapp');
end;
$$;

create or replace function public.reschedule_visit(p_visit_id uuid, p_scheduled_at timestamptz)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_visit public.visits%rowtype;
  v_tz    text;
begin
  select * into v_visit from public.visits where id = p_visit_id for update;
  if not found then
    raise exception 'Visita não encontrada' using errcode = 'P0002';
  end if;
  if v_visit.status not in ('agendada', 'reagendada') then
    raise exception 'Só visitas agendadas podem ser reagendadas' using errcode = '22023';
  end if;
  select timezone into v_tz from public.organizations where id = v_visit.org_id;
  -- mudou de dia: sai da rota antiga (a rota do novo dia é montada em /rotas)
  update public.visits
     set scheduled_at = p_scheduled_at,
         route_id = case when (p_scheduled_at at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date
                            = (v_visit.scheduled_at at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date
                         then route_id end,
         route_order = case when (p_scheduled_at at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date
                            = (v_visit.scheduled_at at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date
                         then route_order end
   where id = v_visit.id;
  update public.follow_ups set due_date = (p_scheduled_at at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date
   where visit_id = v_visit.id and status = 'pendente';
end;
$$;

-- ---------------------------------------------------------------------------
-- Salvar rota do dia: ordem das visitas + KM/tempo calculados no app
-- (a rota guarda só logística; dados do cliente continuam em accounts)
-- ---------------------------------------------------------------------------
create or replace function public.save_route(
  p_route_date  date,
  p_visit_ids   uuid[],
  p_km          numeric,
  p_minutes     int,
  p_source      text,
  p_start_time  time default null,
  p_times       timestamptz[] default null,   -- novos horários (mesma ordem), opcional
  p_shift       text default 'dia_todo',
  p_notes       text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org   uuid := public.current_org_id();
  v_route uuid;
  v_tz    text;
  i       int;
begin
  if v_org is null then
    raise exception 'Usuário sem organização' using errcode = '42501';
  end if;
  if p_source not in ('ruas', 'linha_reta') then
    raise exception 'Origem da distância inválida' using errcode = '22023';
  end if;
  if p_times is not null and coalesce(array_length(p_times, 1), 0) <> coalesce(array_length(p_visit_ids, 1), 0) then
    raise exception 'Horários e visitas com tamanhos diferentes' using errcode = '22023';
  end if;
  select timezone into v_tz from public.organizations where id = v_org;

  -- todas as visitas precisam ser da org, do dia e estar abertas
  if exists (
    select 1 from unnest(p_visit_ids) vid
    left join public.visits v on v.id = vid
    where v.id is null or v.status not in ('agendada', 'em_andamento', 'reagendada')
       or (v.scheduled_at at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date <> p_route_date
  ) then
    raise exception 'Há visitas fora do dia ou já encerradas na rota' using errcode = '22023';
  end if;

  select id into v_route from public.routes
   where org_id = v_org and owner_id = auth.uid() and route_date = p_route_date and status <> 'cancelada'
   for update;
  if v_route is null then
    insert into public.routes (org_id, owner_id, route_date, shift, work_mode, status, estimated_km, estimated_minutes,
                               distance_source, start_time, logistics_notes)
    values (v_org, auth.uid(), p_route_date, p_shift, 'campo', 'planejada', round(p_km, 1), p_minutes, p_source,
            p_start_time, nullif(trim(p_notes), ''))
    returning id into v_route;
  else
    update public.routes
       set estimated_km = round(p_km, 1), estimated_minutes = p_minutes, distance_source = p_source,
           start_time = coalesce(p_start_time, start_time), shift = p_shift,
           logistics_notes = coalesce(nullif(trim(p_notes), ''), logistics_notes)
     where id = v_route;
  end if;

  -- tira da rota visitas que saíram da lista
  update public.visits set route_id = null, route_order = null
   where route_id = v_route and not (id = any (p_visit_ids));

  for i in 1 .. coalesce(array_length(p_visit_ids, 1), 0) loop
    update public.visits
       set route_id = v_route, route_order = i,
           scheduled_at = case when p_times is not null then p_times[i] else scheduled_at end
     where id = p_visit_ids[i];
  end loop;

  return v_route;
end;
$$;

create or replace function public.set_route_status(p_route_id uuid, p_status text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('planejada', 'em_andamento', 'concluida', 'cancelada') then
    raise exception 'Status inválido' using errcode = '22023';
  end if;
  update public.routes set status = p_status where id = p_route_id;
  if not found then
    raise exception 'Rota não encontrada' using errcode = 'P0002';
  end if;
  if p_status = 'cancelada' then
    update public.visits set route_id = null, route_order = null where route_id = p_route_id;
  end if;
end;
$$;

revoke execute on function public.fu_set_next(uuid, uuid, text, date, text, text, text) from public, anon;
revoke execute on function public.fu_ensure_next(uuid, uuid, text, date, text) from public, anon;
revoke execute on function public.move_opportunity(uuid, text, numeric, text, text) from public, anon;
revoke execute on function public.create_opportunity(uuid, text, numeric, text, text, uuid) from public, anon;
revoke execute on function public.set_account_status(uuid, text, numeric, text) from public, anon;
revoke execute on function public.cancel_visit(uuid, text) from public, anon;
revoke execute on function public.reschedule_visit(uuid, timestamptz) from public, anon;
revoke execute on function public.save_route(date, uuid[], numeric, int, text, time, timestamptz[], text, text) from public, anon;
revoke execute on function public.set_route_status(uuid, text) from public, anon;

grant execute on function public.fu_set_next(uuid, uuid, text, date, text, text, text) to authenticated;
grant execute on function public.fu_ensure_next(uuid, uuid, text, date, text) to authenticated;
grant execute on function public.move_opportunity(uuid, text, numeric, text, text) to authenticated;
grant execute on function public.create_opportunity(uuid, text, numeric, text, text, uuid) to authenticated;
grant execute on function public.set_account_status(uuid, text, numeric, text) to authenticated;
grant execute on function public.cancel_visit(uuid, text) to authenticated;
grant execute on function public.reschedule_visit(uuid, timestamptz) to authenticated;
grant execute on function public.save_route(date, uuid[], numeric, int, text, time, timestamptz[], text, text) to authenticated;
grant execute on function public.set_route_status(uuid, text) to authenticated;

-- Tempo real também para rotas
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'routes') then
    alter publication supabase_realtime add table public.routes;
  end if;
end;
$$;

-- >>> supabase/migrations/20261029001000_goal_periods.sql
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
