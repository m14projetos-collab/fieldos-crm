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
