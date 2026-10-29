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
