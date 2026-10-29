-- FieldOS CRM — 0008 Visitante sem login (anon) sem acesso às tabelas e views.
-- O RLS já devolvia zero linhas para o anon (as policies são "to authenticated"); isto fecha a porta
-- também no nível de permissão, como segunda camada.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on sequences from anon';
  end if;
end;
$$;
