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
