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
-- meta recorrente: diária válida por 1 ano conta só HOJE; mensal conta o mês
insert into goals (title, category, period_type, start_date, end_date, target_value)
values ('Visitas/dia (ano)', 'visitas', 'diaria', public.org_today(:'org_a') - 200, public.org_today(:'org_a') + 165, 6),
       ('Vendas do mês', 'vendas', 'mensal', public.org_today(:'org_a') - 200, public.org_today(:'org_a') + 165, 8);
reset role;
update visits set completed_at = completed_at - interval '40 days' where id = :'visit1';
set role authenticated;
select pg_temp.assert((select actual_value from vw_goal_progress where title = 'Visitas/dia (ano)') = 2, 'meta diária recorrente conta só o dia de hoje');
select pg_temp.assert((select period_start = period_end and period_start = public.org_today(:'org_a') from vw_goal_progress where title = 'Visitas/dia (ano)'), 'janela da meta diária = hoje');
select pg_temp.assert((select actual_value from vw_goal_progress where title = 'Vendas do mês') = 1, 'meta mensal conta vendas do mês');
reset role;
update visits set completed_at = completed_at + interval '40 days' where id = :'visit1';
set role authenticated;

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


-- ===================== Fase 2: pipeline, status da conta e rotas (0009) =====================
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
create or replace function pg_temp.expect_error(p_sql text, p_hint text, msg text) returns void language plpgsql as $$
declare v_hint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if p_hint is not null and coalesce(v_hint, '') <> p_hint then
      raise exception 'FALHOU: % (hint esperado %, veio % / %)', msg, p_hint, v_hint, sqlerrm;
    end if;
    raise notice 'ok: % (%)', msg, sqlerrm;
    return;
  end;
  raise exception 'FALHOU: % (não deu erro)', msg;
end $$;

select public.create_lead('Pizzaria Pipeline', '21944440009', 'Campo Grande', 'Saipos', 'Pizzaria', 'Oeste') as accp \gset
select public.create_opportunity(:'accp') as opp1 \gset
select pg_temp.assert((select stage = 'qualificado' and probability = 35 from opportunities where id = :'opp1'), 'nova oportunidade em qualificado');
select pg_temp.assert((select status from accounts where id = :'accp') = 'discovery', 'conta acompanha: discovery');
select pg_temp.assert((select count(*) from follow_ups where account_id = :'accp' and status = 'pendente') = 1,
  'nova oportunidade não duplica a próxima ação');
select pg_temp.expect_error(format('select public.move_opportunity(%L, %L)', :'opp1', 'fechado'), 'MRR_REQUIRED',
  'fechar sem MRR é bloqueado');
select pg_temp.expect_error(format('select public.move_opportunity(%L, %L)', :'opp1', 'perdido'), 'LOSS_REASON_REQUIRED',
  'perder sem motivo é bloqueado');
select pg_temp.expect_error(format('select public.create_opportunity(%L)', :'accp'), 'OPEN_OPP_EXISTS',
  'não cria segunda oportunidade aberta na mesma conta');

select public.move_opportunity(:'opp1', 'proposta_enviada');
select pg_temp.assert((select status from accounts where id = :'accp') = 'proposta_enviada', 'mover p/ proposta move a conta');
select pg_temp.assert((select probability = 65 and proposal_sent_at is not null from opportunities where id = :'opp1'),
  'proposta: probabilidade 65 e data de envio');
select pg_temp.assert((select count(*) from follow_ups where account_id = :'accp' and status = 'pendente') = 1,
  'proposta: exatamente 1 próxima ação');
select pg_temp.assert((select title like 'Cobrar decisão%' from follow_ups where account_id = :'accp' and status = 'pendente'),
  'proposta: próxima ação é cobrar decisão');

select public.move_opportunity(:'opp1', 'qualificado');
select pg_temp.assert((select status from accounts where id = :'accp') = 'proposta_enviada', 'voltar etapa no Kanban não rebaixa a conta');
select pg_temp.assert((select count(*) from follow_ups where account_id = :'accp' and status = 'pendente') = 1,
  'voltar etapa mantém 1 próxima ação (sem duplicar)');

select public.move_opportunity(:'opp1', 'fechado', 299);
select pg_temp.assert((select status = 'fechado' and post_sale_phase = 'onboarding' from accounts where id = :'accp'),
  'fechar: conta vira cliente em onboarding');
select pg_temp.assert((select mrr_value = 299 and closed_at is not null and probability = 100 from opportunities where id = :'opp1'),
  'fechar: MRR, data e 100%');
select pg_temp.assert((select count(*) from follow_ups where account_id = :'accp' and status = 'pendente' and channel = 'visita'
  and due_date = org_today(:'org_a') + 7) = 1, 'fechar: pós-venda em 7 dias');
select pg_temp.assert((select count(*) from follow_ups where account_id = :'accp' and status = 'pendente') = 1,
  'fechar: só 1 próxima ação');
select pg_temp.assert((select actual_value from vw_goal_progress where title = 'Visitas do dia') = 3, 'mover no Kanban não infla meta de visitas');

-- upsell num cliente não rebaixa a conta
select public.create_opportunity(:'acc1', 'qualificado', 50, 'Módulo delivery') as opp_up \gset
select pg_temp.assert((select status from accounts where id = :'acc1') = 'fechado', 'upsell aberto mantém cliente como fechado');
select public.move_opportunity(:'opp_up', 'perdido', null, 'preco', 'achou caro');
select pg_temp.assert((select status from accounts where id = :'acc1') = 'fechado', 'upsell perdido mantém cliente');
select pg_temp.assert((select loss_category = 'preco' and loss_detail = 'achou caro' and probability = 0 from opportunities where id = :'opp_up'),
  'perda registra motivo e zera probabilidade');

-- Kanban de prospecção (status da conta)
select public.create_lead('Hamburgueria Teste', '21988880002', 'Santa Cruz', 'iFood', 'Hamburgueria', 'Oeste') as acc2 \gset
select public.set_account_status(:'acc2', 'discovery');
select pg_temp.assert((select status from accounts where id = :'acc2') = 'discovery', 'status discovery');
select pg_temp.assert((select count(*) from follow_ups where account_id = :'acc2' and status = 'pendente') = 1,
  'discovery: mantém 1 próxima ação');
select public.set_account_status(:'acc2', 'proposta_enviada', 199);
select pg_temp.assert((select stage = 'proposta_enviada' and mrr_value = 199 from opportunities where account_id = :'acc2'),
  'arrastar conta p/ proposta cria a oportunidade');
select pg_temp.assert((select count(*) from opportunities where account_id = :'acc2') = 1, 'sem oportunidade duplicada');
select pg_temp.assert((select count(*) from follow_ups where account_id = :'acc2' and status = 'pendente') = 1,
  'proposta via conta: 1 próxima ação');
select pg_temp.expect_error(format('select public.set_account_status(%L, %L)', :'acc2', 'primeiro_contato'), 'OPEN_OPP_EXISTS',
  'não esconde negociação aberta voltando a conta para prospecção');
select pg_temp.expect_error(format('select public.set_account_status(%L, %L)', :'acc2', 'perdido'), 'LOSS_REASON_REQUIRED',
  'conta perdida exige motivo');
select public.set_account_status(:'acc2', 'perdido', null, 'ja_tem_sistema');
select pg_temp.assert((select status = 'perdido' and loss_reason = 'ja_tem_sistema' from accounts where id = :'acc2'), 'conta perdida');
select pg_temp.assert((select stage from opportunities where account_id = :'acc2') = 'perdido', 'oportunidade aberta vira perdida');
select pg_temp.assert((select count(*) from follow_ups where account_id = :'acc2' and status = 'pendente'
  and due_date = org_today(:'org_a') + 90 and priority = 'baixa') = 1, 'perdido: recuperação em 90 dias (única ação)');
select public.set_account_status(:'acc2', 'primeiro_contato');
select pg_temp.assert((select status = 'primeiro_contato' and loss_reason is null from accounts where id = :'acc2'),
  'reativar conta perdida limpa o motivo');

select public.create_lead('Açaí Teste', '21977770003', 'Paciência', null, 'Açaí', 'Oeste') as acc3 \gset
select public.set_account_status(:'acc3', 'fechado', 350);
select pg_temp.assert((select stage = 'fechado' and mrr_value = 350 and closed_at is not null from opportunities where account_id = :'acc3'),
  'fechar direto pela conta cria venda com MRR');
select pg_temp.assert((select status from accounts where id = :'acc3') = 'fechado', 'conta fechada');

-- Rotas
select public.create_lead('Pastelaria Rota', '21966660004', 'Campo Grande', null, 'Pastelaria', 'Oeste') as acc4 \gset
select public.create_lead('Restaurante Rota', '21955550005', 'Inhoaíba', null, 'Restaurante', 'Oeste') as acc5 \gset
select ((org_today(:'org_a')::timestamp + time '10:00') at time zone 'America/Sao_Paulo') as t10 \gset
select ((org_today(:'org_a')::timestamp + time '14:00') at time zone 'America/Sao_Paulo') as t14 \gset
select public.schedule_visit(:'acc4', :'t10', 'primeiro_contato', 45) as v4 \gset
select public.schedule_visit(:'acc5', :'t14', 'primeiro_contato', 45) as v5 \gset
select public.save_route(org_today(:'org_a'), array[:'v5', :'v4']::uuid[], 12.34, 75, 'linha_reta', '09:00') as route1 \gset
select pg_temp.assert((select route_order from visits where id = :'v5') = 1 and (select route_order from visits where id = :'v4') = 2,
  'rota grava a ordem otimizada');
select pg_temp.assert((select estimated_km = 12.3 and estimated_minutes = 75 and distance_source = 'linha_reta' from routes where id = :'route1'),
  'rota grava KM, tempo e origem');
select public.save_route(org_today(:'org_a'), array[:'v4']::uuid[], 5, 30, 'ruas') as route2 \gset
select pg_temp.assert(:'route1' = :'route2', 'salvar de novo atualiza a mesma rota (sem duplicar)');
select pg_temp.assert((select count(*) from routes) = 1, 'uma rota por vendedor por dia');
select pg_temp.assert((select route_id is null and route_order is null from visits where id = :'v5'), 'visita removida sai da rota');
select pg_temp.expect_error(format('select public.save_route(%L::date, array[%L]::uuid[], 1, 1, %L)',
  org_today(:'org_a') + 1, :'v4', 'ruas'), null, 'rota não aceita visita de outro dia');
select pg_temp.expect_error(format('select public.save_route(%L::date, array[%L]::uuid[], 1, 1, %L)',
  org_today(:'org_a'), :'v4', 'gps'), null, 'origem de distância inválida é recusada');

select public.reschedule_visit(:'v4', (:'t10')::timestamptz + interval '1 day');
select pg_temp.assert((select route_id is null from visits where id = :'v4'), 'reagendar para outro dia tira da rota');
select pg_temp.assert((select due_date from follow_ups where visit_id = :'v4' and status = 'pendente') = org_today(:'org_a') + 1,
  'reagendar move o follow-up da visita');

select public.cancel_visit(:'v5', 'dono viajou');
select pg_temp.assert((select status from visits where id = :'v5') = 'cancelada', 'visita cancelada');
select pg_temp.assert((select count(*) from follow_ups where visit_id = :'v5' and status = 'pendente') = 0,
  'follow-up da visita cancelada sai da fila');
select pg_temp.assert((select count(*) from follow_ups where account_id = :'acc5' and status = 'pendente') >= 1,
  'conta da visita cancelada continua com próxima ação');
select pg_temp.expect_error(format('select public.cancel_visit(%L)', :'v5'), null, 'não cancela duas vezes');

select public.set_route_status(:'route1', 'cancelada');
select pg_temp.assert((select count(*) from visits where route_id = :'route1') = 0, 'cancelar rota solta as visitas');
select public.save_route(org_today(:'org_a'), array[]::uuid[], 0, 0, 'ruas') as route3 \gset
select pg_temp.assert(:'route3' <> :'route1', 'depois de cancelada, pode criar nova rota no dia');

-- B não move oportunidade de A
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.expect_error(format('select public.move_opportunity(%L, %L)', :'opp1', 'perdido'), null,
  'B não move oportunidade de A');
select pg_temp.expect_error(format('select public.set_account_status(%L, %L)', :'acc4', 'discovery'), null,
  'B não muda status de conta de A');
reset role;
select pg_temp.assert((select stage from opportunities where id = :'opp1') = 'fechado', 'oportunidade de A intacta');

-- ---------------------------------------------------------------------------
-- 0011 webhooks: dispara só com config ligada, URL segura e evento marcado
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.assert(public.webhook_url_ok('https://hook.us1.make.com/abc'), 'URL do Make aceita');
select pg_temp.assert(not public.webhook_url_ok('http://hook.make.com/abc'), 'http recusado');
select pg_temp.assert(not public.webhook_url_ok('https://192.168.0.5/x'), 'rede interna recusada');
select pg_temp.assert(not public.webhook_url_ok('https://localhost/x'), 'localhost recusado');
truncate net.calls;
update public.organizations set settings = jsonb_build_object('webhook', jsonb_build_object(
  'enabled', true, 'url', 'https://hook.us1.make.com/abc', 'events', jsonb_build_array('proposal.sent', 'deal.won', 'visit.checkin')))
where id = :'org_a';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.create_lead('Bar Webhook', '21944440077', 'Bangu', null, 'Bar', 'Oeste') as accw \gset
select public.create_opportunity(:'accw') as oppw \gset
select public.move_opportunity(:'oppw', 'proposta_enviada');
select public.move_opportunity(:'oppw', 'fechado', 349);
select public.schedule_visit(:'accw', now(), 'pos_venda') as visw \gset
select public.log_visit_outcome(:'visw', 'interesse_confirmado');
reset role;
select pg_temp.assert((select count(*) from net.calls) = 3, 'webhook: proposta, venda e check-in = 3 disparos');
select pg_temp.assert((select array_agg(body->>'event' order by id) from net.calls) = array['proposal.sent', 'deal.won', 'visit.checkin'],
  'webhook: eventos na ordem certa');
select pg_temp.assert((select body->'account'->>'name' from net.calls order by id limit 1) = 'Bar Webhook', 'webhook leva a conta');
select pg_temp.assert((select (body->'opportunity'->>'mrr_value')::numeric from net.calls where body->>'event' = 'deal.won') = 349,
  'webhook de venda leva o MRR');
-- evento desmarcado e config desligada não disparam
update public.organizations set settings = jsonb_set(settings, '{webhook,events}', '["deal.won"]') where id = :'org_a';
truncate net.calls;
set role authenticated;
select public.schedule_visit(:'accw', now(), 'pos_venda') as visw2 \gset
select public.log_visit_outcome(:'visw2', 'interesse_confirmado');
reset role;
select pg_temp.assert((select count(*) from net.calls) = 0, 'evento desmarcado não dispara');
update public.organizations set settings = jsonb_set(settings, '{webhook,url}', '"http://inseguro.com"') where id = :'org_a';
update public.organizations set settings = jsonb_set(settings, '{webhook,events}', '["visit.checkin"]') where id = :'org_a';
set role authenticated;
select public.schedule_visit(:'accw', now(), 'pos_venda') as visw3 \gset
select public.log_visit_outcome(:'visw3', 'interesse_confirmado');
reset role;
select pg_temp.assert((select count(*) from net.calls) = 0, 'URL http não dispara');
-- (o revoke de emit_webhook para authenticated é conferido no Supabase real: aqui o topo do teste dá grant em tudo)

select pg_temp.assert(true, 'TODOS OS CENÁRIOS PASSARAM');
