-- 0012: assinatura de agenda (.ics) por vendedor.
-- O Google Agenda, Outlook ou iPhone assinam https://<app>/api/agenda/<token> e passam a mostrar as visitas sozinhos.
-- O token (48 hex, aleatório) só é mostrado uma vez; o banco guarda apenas o sha256. Gerar outro invalida o anterior.
-- calendar_feed(token) é a única coisa que o anon pode chamar: devolve só as visitas daquele vendedor, sem e-mail nem dado sensível.

create table if not exists public.calendar_feeds (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.calendar_feeds enable row level security;
drop policy if exists calendar_feeds_own on public.calendar_feeds;
create policy calendar_feeds_own on public.calendar_feeds for select to authenticated using (user_id = auth.uid());
revoke all on public.calendar_feeds from anon;
revoke insert, update, delete on public.calendar_feeds from authenticated;

create or replace function public.rotate_calendar_feed()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.current_org_id();
  v_token text;
begin
  if auth.uid() is null or v_org is null then
    raise exception 'Entre na sua conta para gerar o link da agenda' using errcode = '42501';
  end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.calendar_feeds (user_id, org_id, token_hash)
  values (auth.uid(), v_org, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  on conflict (user_id) do update set org_id = excluded.org_id, token_hash = excluded.token_hash, created_at = now();
  return v_token;
end;
$$;

create or replace function public.revoke_calendar_feed()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.calendar_feeds where user_id = auth.uid();
$$;

create or replace function public.calendar_feed(p_token text)
returns table (
  id uuid, scheduled_at timestamptz, duration_minutes int, visit_type text, status text,
  account_name text, address text, neighborhood text, city text, phone text, decision_maker text
)
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select cf.user_id, cf.org_id from public.calendar_feeds cf
    where p_token ~ '^[0-9a-f]{64}$'
      and cf.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  )
  select v.id, v.scheduled_at, v.duration_minutes, v.visit_type, v.status,
         a.name, a.address, a.neighborhood, a.city, coalesce(a.whatsapp, a.phone), a.decision_maker_name
  from f
  join public.visits v on v.org_id = f.org_id and v.owner_id = f.user_id
  join public.accounts a on a.id = v.account_id and a.org_id = v.org_id
  where v.status in ('agendada', 'em_andamento', 'reagendada', 'realizada')
    and v.scheduled_at >= now() - interval '14 days'
    and v.scheduled_at <  now() + interval '90 days'
  order by v.scheduled_at
  limit 500;
$$;

revoke all on function public.rotate_calendar_feed() from public, anon;
revoke all on function public.revoke_calendar_feed() from public, anon;
revoke all on function public.calendar_feed(text) from public;
grant execute on function public.rotate_calendar_feed() to authenticated;
grant execute on function public.revoke_calendar_feed() to authenticated;
grant execute on function public.calendar_feed(text) to anon, authenticated;

-- Webhook passa a levar o e-mail do restaurante (receita "boas-vindas por Gmail" no Make/n8n).
create or replace function public.webhook_account(p_account uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'status', a.status, 'neighborhood', a.neighborhood, 'region', a.region,
    'phone', a.phone, 'whatsapp', a.whatsapp, 'email', a.email, 'current_system', a.current_system, 'persona', a.persona,
    'decision_maker_name', a.decision_maker_name
  )
  from public.accounts a where a.id = p_account;
$$;
revoke all on function public.webhook_account(uuid) from public, anon, authenticated;
