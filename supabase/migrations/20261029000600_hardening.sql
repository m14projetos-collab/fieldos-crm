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
