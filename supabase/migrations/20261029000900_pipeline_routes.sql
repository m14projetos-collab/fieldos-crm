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
