-- ============================================================================
-- FieldOS CRM — 0005 Realtime: o app invalida o cache quando algo muda
-- (o RLS continua valendo para as mensagens de realtime)
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.accounts, public.visits, public.opportunities, public.follow_ups;
  end if;
end;
$$;
