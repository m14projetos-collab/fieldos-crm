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
