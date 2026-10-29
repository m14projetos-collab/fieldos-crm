-- Cenários de validação (rodar depois de 00_auth_stub.sql + migrations).
-- Uso: ./supabase/tests/run.sh   (Postgres local, sem Supabase)
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Grants que o Supabase aplica por padrão
grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'michel@takeat.test'),
  ('00000000-0000-0000-0000-00000000000b', 'outro@concorrente.test'),
  ('00000000-0000-0000-0000-00000000000c', 'Vendedor@Takeat.test'),
  ('00000000-0000-0000-0000-00000000000d', 'sem.convite@x.test');

-- helper de asserção
create or replace function pg_temp.assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;
set client_min_messages = notice;

-- ===================== Usuário A: onboarding + dados =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.create_organization('Takeat Zona Oeste', 'takeat-zo', 'Michel Alessandro') as org_a \gset
select pg_temp.assert(public.current_org_id() = :'org_a', 'A enxerga a própria org');

select public.create_lead('Pizzaria Bella Posse', '21999990001', 'Campo Grande', 'Saipos', 'Pizzaria', 'Oeste') as acc1 \gset
select pg_temp.assert(
  (select count(*) from follow_ups where account_id = :'acc1' and status = 'pendente' and cadence_step = 0) = 1,
  'novo lead já nasce com follow-up Dia 0');

-- completar o Dia 0 sem próximo é permitido (conta vira primeiro_contato = ativa → exige próximo)
do $$
declare v_fu uuid; v_acc uuid;
begin
  select id, account_id into v_fu, v_acc from public.follow_ups where cadence_step = 0 limit 1;
  begin
    perform public.complete_follow_up(v_fu, 'concluido', null, null, null);
    raise exception 'FALHOU: deveria exigir próximo follow-up';
  exception when raise_exception then
    if sqlerrm like 'FALHOU%' then raise; end if;
    raise notice 'ok: conta ativa sem próximo follow-up é bloqueada (%)', sqlerrm;
  end;
end $$;

select public.complete_follow_up(
  (select id from follow_ups where account_id = :'acc1' and status = 'pendente'), 'concluido', 2, null, null);
select pg_temp.assert(
  (select cadence_step from follow_ups where account_id = :'acc1' and status = 'pendente') = 2,
  'cadência avança para o Dia 2');
select pg_temp.assert((select status from accounts where id = :'acc1') = 'primeiro_contato', 'conta vira primeiro_contato');
select pg_temp.assert((select cadence_day from accounts where id = :'acc1') = 2, 'accounts.cadence_day acompanha');

-- agenda visita e faz o Quick Log "proposta solicitada"
select public.schedule_visit(:'acc1', now() + interval '1 hour', 'primeiro_contato', 45) as visit1 \gset
select pg_temp.assert((select status from accounts where id = :'acc1') = 'agendado', 'agendar visita move conta para agendado');
select pg_temp.assert(
  (select count(*) from follow_ups where account_id = :'acc1' and status = 'pendente') = 2,
  'visita agendada vira próxima ação (follow-up canal visita)');

select public.log_visit_outcome(:'visit1', 'proposta_solicitada', null, null, 'Dono quer 4 terminais') as r1 \gset
select pg_temp.assert((select status from visits where id = :'visit1') = 'realizada', 'visita realizada');
select pg_temp.assert((select status from accounts where id = :'acc1') = 'demo_realizada', 'conta avança para demo_realizada');
select pg_temp.assert((select interest_level from accounts where id = :'acc1') = 'quente', 'interesse quente');
select pg_temp.assert((select stage from opportunities where account_id = :'acc1') = 'demo_agendada', 'oportunidade criada no pipeline');
select pg_temp.assert(
  (select count(*) from follow_ups where account_id = :'acc1' and status = 'pendente') = 1,
  'exatamente 1 próxima ação após o Quick Log');
select pg_temp.assert(
  (select channel from follow_ups where account_id = :'acc1' and status = 'pendente') = 'proposta',
  'próxima ação = enviar proposta');

-- visita repetida não pode ser registrada duas vezes
do $$ begin
  perform public.log_visit_outcome((select id from public.visits limit 1), 'fechado');
  raise exception 'FALHOU: aceitou check-in duplicado';
exception when sqlstate '22023' then raise notice 'ok: check-in duplicado bloqueado';
end $$;

-- segunda visita: fechou!
select public.schedule_visit(:'acc1', now() + interval '2 hours', 'fechamento', 30) as visit2 \gset
select public.log_visit_outcome(:'visit2', 'fechado') as r2 \gset
select pg_temp.assert((select status from accounts where id = :'acc1') = 'fechado', 'conta fechada');
select pg_temp.assert((select post_sale_phase from accounts where id = :'acc1') = 'onboarding', 'pós-venda: onboarding');
select pg_temp.assert(
  (select count(*) from opportunities where account_id = :'acc1') = 1
  and (select stage from opportunities where account_id = :'acc1') = 'fechado'
  and (select closed_at from opportunities where account_id = :'acc1') is not null,
  'mesma oportunidade avançou para fechado (sem duplicar)');
select pg_temp.assert(
  (select due_date - public.org_today(org_id) from follow_ups where account_id = :'acc1' and status = 'pendente') = 7,
  'follow-up pós-venda em 7 dias');

-- outra conta: sem interesse → perdido + recuperação em 90 dias
select public.create_lead('Hamburgueria Smash Bangu', '21999990002', 'Bangu', 'Planilha / Manual', 'Hamburgueria', 'Oeste') as acc2 \gset
select public.schedule_visit(:'acc2', now(), 'primeiro_contato', 45) as visit3 \gset
select public.log_visit_outcome(:'visit3', 'sem_interesse');
select pg_temp.assert((select status from accounts where id = :'acc2') = 'perdido', 'sem interesse → perdido');
select pg_temp.assert(
  (select due_date - public.org_today(org_id) from follow_ups where account_id = :'acc2' and status = 'pendente') = 90,
  'recuperação agendada em 90 dias');

-- Score e completude (view com security_invoker)
-- acc1: alta? não (media=12) + quente 25 + status fechado (outros=5) + visitas 2*5=10 + follow-ups 5*3=15→12 + opp ativa 8 - 0 = 72
select pg_temp.assert((select commercial_score from vw_accounts_enriched where id = :'acc1') = 72,
  'score acc1 = 72 (mesmo valor do teste TS)');
select pg_temp.assert((select funnel_stage from vw_accounts_enriched where id = :'acc1') = 'cliente', 'funil: cliente');
select pg_temp.assert((select missing_field from vw_accounts_enriched where id = :'acc1') is null, 'acc1 completa');

-- metas calculadas
insert into goals (title, category, period_type, start_date, end_date, target_value)
values ('Visitas do dia', 'visitas', 'diaria', public.org_today(:'org_a'), public.org_today(:'org_a'), 6);
select pg_temp.assert((select actual_value from vw_goal_progress where category = 'visitas') = 3, 'meta de visitas: 3 realizadas');

-- ===================== Usuário B: isolamento =====================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select public.create_organization('Concorrente', 'concorrente', 'Fulano') as org_b \gset
select pg_temp.assert((select count(*) from accounts) = 0, 'B não vê contas de A');
select pg_temp.assert((select count(*) from vw_accounts_enriched) = 0, 'B não vê contas de A pela view');
select pg_temp.assert((select count(*) from vw_goal_progress) = 0, 'B não vê metas de A');
select pg_temp.assert((select count(*) from organizations) = 1, 'B só vê a própria org');

-- B tenta inserir visita apontando para conta de A (FK composta + RLS)
\set ON_ERROR_STOP off
\echo 'esperado: erro de FK abaixo'
insert into visits (account_id, scheduled_at) values (:'acc1', now());
\echo 'esperado: Visita não encontrada abaixo'
select public.log_visit_outcome(:'visit1', 'fechado');
\set ON_ERROR_STOP on
select pg_temp.assert((select count(*) from visits) = 0, 'B não criou visita na conta de A');
reset role;
select pg_temp.assert((select count(*) from visits where account_id = :'acc1') = 2, 'visitas de A intactas');
select pg_temp.assert((select outcome from visits where id = :'visit1') = 'proposta_solicitada', 'B não alterou a visita de A');
set role authenticated;

-- B tenta se promover / trocar org
do $$ begin
  update public.profiles set org_id = (select id from public.organizations limit 1) where id = auth.uid();
  raise notice 'ok: (mesma org, sem efeito)';
end $$;

reset role;
-- ===================== Convites =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into org_invites (email, full_name) values ('vendedor@takeat.test', 'Vendedor Um');
select pg_temp.assert((select count(*) from org_invites) = 1, 'admin A vê o convite');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.assert((select count(*) from org_invites) = 0, 'B não vê convites de A');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
select pg_temp.assert(public.accept_invite() = :'org_a', 'convidado entra na org A (e-mail sem diferenciar maiúsculas)');
select pg_temp.assert(public.current_org_id() = :'org_a', 'convidado enxerga a org A');
select pg_temp.assert((select count(*) from accounts) > 0, 'convidado vê as contas da org');
select pg_temp.assert((select role from profiles where id = auth.uid()) = 'ae', 'convidado entra como ae');
select pg_temp.assert((select count(*) from org_invites) = 0, 'ae não vê convites');
select pg_temp.assert(public.accept_invite() = :'org_a', 'aceitar de novo é idempotente');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false);
select pg_temp.assert(public.accept_invite() is null, 'sem convite: segue para criar organização');
reset role;
select pg_temp.assert((select accepted_at is not null from org_invites where email = 'vendedor@takeat.test'), 'convite marcado como aceito');

-- Visitante sem login (anon) não executa nenhuma função do app (migration 0006)
select pg_temp.assert(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')),
  'anon sem EXECUTE em funções do public');
select pg_temp.assert(
  not exists (select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
  'anon sem permissão em tabelas e views');
select pg_temp.assert(has_function_privilege('authenticated', 'public.create_organization(text,text,text)', 'execute'),
  'authenticated ainda cria organização');

select pg_temp.assert(true, 'TODOS OS CENÁRIOS PASSARAM');
