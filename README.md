# FieldOS CRM — Edição Takeat Foodservice

Sistema operacional comercial para vendas em campo (field sales) e inside sales. Multi-tenant, pronto para virar SaaS.
Stack: Next.js 15 (App Router) · TypeScript · Tailwind 4 · Supabase (Postgres + Auth + RLS + Realtime) ·
TanStack Query · Zustand · cmdk · Radix.

Plano por fases e critérios de aceite: [`docs/PLANO.md`](docs/PLANO.md).

## Rodar agora (modo demo, sem Supabase)

```bash
npm install
npm run dev        # http://localhost:3000
```

Sem variáveis de ambiente o app abre em **modo demo**: dados fictícios salvos só no navegador, com as mesmas
regras de negócio do banco. "Restaurar dados de exemplo" fica na barra lateral.

## Ligar ao Supabase (plano gratuito)

> Projeto atual: `tdvefdpnfglomxfafcib` (fieldos-crm). As 6 migrations **já foram aplicadas** em 2026-10-29
> pelo conector do Supabase; pule para o passo 3. Como foram aplicadas pelo conector, as versões no histórico
> remoto não batem com os nomes dos arquivos: **não rode `supabase db push` nesse projeto** sem antes alinhar
> com `supabase migration repair` (senão a CLI tenta recriar as tabelas e falha).

1. Crie um projeto no Supabase (ex.: `fieldos-crm`).
2. Aplique as migrations, em ordem:
   - com a CLI: `npx supabase link --project-ref <ref>` e depois `npx supabase db push`; ou
   - pelo SQL Editor: cole e rode cada arquivo de `supabase/migrations/` na ordem do nome.
3. Em *Authentication → URL Configuration*, coloque a URL do app (ex.: `http://localhost:3000`) em Site URL e Redirect URLs.
4. Copie `.env.example` para `.env.local` e preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (*Project Settings → API*).
5. `npm run dev`, entre com seu e-mail (link mágico) e crie a organização.

A chave anon é pública por design; a segurança vem do RLS. Nunca coloque a `service_role` no front-end.

## Testes

```bash
npm test                         # regras de negócio em TS (vitest)
npx tsc --noEmit && npm run lint # tipos e lint
# migrations + RLS + RPCs num Postgres 15+ descartável (sem Supabase):
PGBIN=/usr/lib/postgresql/16/bin ./supabase/tests/run.sh
```

`supabase/tests/01_scenarios.sql` e `src/lib/domain/domain.test.ts` rodam o mesmo roteiro (lead → cadência → visita
→ proposta → fechado) e conferem o mesmo score (72). Se as regras do SQL e do TS divergirem, um dos dois quebra.

## Estrutura

```
supabase/migrations/   schema, RLS, views calculadas, RPCs das ações rápidas, realtime
supabase/tests/        stub do auth + cenários (isolamento entre orgs, Quick Log, regra da próxima ação)
src/lib/domain/        regras puras: score, próxima ação, transições (espelho das RPCs), cadência, ancoragem, "Hoje"
src/lib/data/          Repo (demo | Supabase), cache TanStack Query com mutação otimista
src/components/        Hoje, Quick Log, Gaveta 360º, Command Palette, diálogos, shell
```

## Regras que o sistema garante

- Dados cadastrais e geográficos só em `accounts`. Visitas, rotas e pipeline leem por relação.
- `follow_ups` é a única fonte de próxima ação. Conta em negociação ativa não fica sem follow-up pendente.
- Metas, KPIs e alertas são calculados dos registros; nada de número digitado.
