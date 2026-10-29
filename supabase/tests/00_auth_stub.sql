-- Stub mínimo do ambiente Supabase para validar as migrations num Postgres puro.
-- NÃO aplicar no Supabase (lá isso já existe).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

-- Stub do pg_net (no Supabase é a extensão real): grava as chamadas para o teste conferir.
create schema net;
create table net.calls (id serial primary key, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.calls (url, body, headers) values (url, body, headers) returning id::bigint $$;
