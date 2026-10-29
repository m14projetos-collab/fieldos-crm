-- 0011: webhooks de saída (Make / n8n / Zapier) disparados pelo banco.
-- Eventos: visit.checkin (visita realizada), proposal.sent (proposta enviada), deal.won (venda fechada).
-- A configuração fica em organizations.settings->'webhook' = {"enabled": true, "url": "https://...", "events": [...]},
-- gravada pela tela Integrações (só admin, pela RLS org_update).
-- Envio assíncrono via pg_net: não atrasa nem derruba a transação do vendedor; falha de rede só fica no log do pg_net.

do $$
begin
  create extension if not exists pg_net;
exception when others then
  -- Postgres local de teste não tem pg_net: o teste cria um stub em net.http_post.
  raise notice 'pg_net indisponível: %', sqlerrm;
end
$$;

-- URL aceita: https, host público (sem localhost, .local ou faixas de rede interna).
create or replace function public.webhook_url_ok(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]+)?(/.*)?$'
     and p_url !~* '^https://(localhost|[^/]*\.local|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)';
$$;
revoke all on function public.webhook_url_ok(text) from public, anon, authenticated;

create or replace function public.emit_webhook(p_org uuid, p_event text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb;
  v_url text;
begin
  select o.settings -> 'webhook' into v_cfg from public.organizations o where o.id = p_org;
  if v_cfg is null or coalesce((v_cfg ->> 'enabled')::boolean, false) is false then
    return;
  end if;
  v_url := v_cfg ->> 'url';
  if v_url is null or not public.webhook_url_ok(v_url) then
    return;
  end if;
  if not coalesce(v_cfg -> 'events' ? p_event, false) then
    return;
  end if;
  begin
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('event', p_event, 'occurred_at', now(), 'org_id', p_org) || p_data,
      headers := jsonb_build_object('Content-Type', 'application/json', 'User-Agent', 'FieldOS-CRM/1.0')
    );
  exception when others then
    -- webhook nunca pode impedir o check-in ou o fechamento
    raise warning 'emit_webhook(%): %', p_event, sqlerrm;
  end;
end;
$$;
revoke all on function public.emit_webhook(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.webhook_account(p_account uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'status', a.status, 'neighborhood', a.neighborhood, 'region', a.region,
    'phone', a.phone, 'whatsapp', a.whatsapp, 'current_system', a.current_system, 'persona', a.persona,
    'decision_maker_name', a.decision_maker_name
  )
  from public.accounts a where a.id = p_account;
$$;
revoke all on function public.webhook_account(uuid) from public, anon, authenticated;

create or replace function public.tg_webhook_visit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'realizada' and old.status is distinct from 'realizada' then
    perform public.emit_webhook(new.org_id, 'visit.checkin', jsonb_build_object(
      'visit', jsonb_build_object('id', new.id, 'scheduled_at', new.scheduled_at, 'completed_at', new.completed_at,
                                  'visit_type', new.visit_type, 'outcome', new.outcome, 'notes', new.checkin_notes),
      'account', public.webhook_account(new.account_id)));
  end if;
  return new;
end;
$$;

create or replace function public.tg_webhook_opportunity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opp jsonb := jsonb_build_object('id', new.id, 'title', new.title, 'stage', new.stage, 'mrr_value', new.mrr_value,
                                    'plan_name', new.plan_name, 'proposal_sent_at', new.proposal_sent_at, 'closed_at', new.closed_at);
begin
  if new.proposal_sent_at is not null and (tg_op = 'INSERT' or old.proposal_sent_at is null) then
    perform public.emit_webhook(new.org_id, 'proposal.sent',
      jsonb_build_object('opportunity', v_opp, 'account', public.webhook_account(new.account_id)));
  end if;
  if new.stage = 'fechado' and (tg_op = 'INSERT' or old.stage is distinct from 'fechado') then
    perform public.emit_webhook(new.org_id, 'deal.won',
      jsonb_build_object('opportunity', v_opp, 'account', public.webhook_account(new.account_id)));
  end if;
  return new;
end;
$$;

drop trigger if exists visits_webhook on public.visits;
create trigger visits_webhook after update of status on public.visits
  for each row execute function public.tg_webhook_visit();

drop trigger if exists opportunities_webhook on public.opportunities;
create trigger opportunities_webhook after insert or update of stage, proposal_sent_at on public.opportunities
  for each row execute function public.tg_webhook_opportunity();

revoke all on function public.tg_webhook_visit() from public, anon, authenticated;
revoke all on function public.tg_webhook_opportunity() from public, anon, authenticated;
