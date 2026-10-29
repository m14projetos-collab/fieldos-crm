"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";
import { DemoRepo } from "@/lib/data/demo-repo";
import { RepoProvider } from "@/lib/data/hooks";
import type { Repo } from "@/lib/data/repo";
import { SupabaseRepo } from "@/lib/data/supabase-repo";
import { DEFAULT_TZ } from "@/lib/domain/dates";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { LoginScreen, OnboardingScreen } from "./auth-screens";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={qc}>
      {supabaseConfigured ? <SupabaseGate>{children}</SupabaseGate> : <DemoGate>{children}</DemoGate>}
      <Toaster theme="dark" position="top-center" richColors closeButton />
    </QueryClientProvider>
  );
}

function DemoGate({ children }: { children: ReactNode }) {
  const repo = useMemo(() => new DemoRepo(), []);
  return <RepoProvider value={repo}>{children}</RepoProvider>;
}

type GateState =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "no_org"; auth: AuthSession }
  | { kind: "ready"; repo: Repo }
  | { kind: "error"; message: string };

function SupabaseGate({ children }: { children: ReactNode }) {
  const sb = getSupabase();
  const [state, setState] = useState<GateState>({ kind: "loading" });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const resolve = async (auth: AuthSession | null) => {
      if (!auth) return setState({ kind: "signed_out" });
      const loadProfile = () =>
        sb
          .from("profiles")
          .select("full_name, org_id, role, organizations(name, timezone)")
          .eq("id", auth.user.id)
          .maybeSingle();
      let { data: prof, error } = await loadProfile();
      if (!error && !prof) {
        // Primeiro acesso: se o admin convidou este e-mail, entra direto na org dele.
        const { data: invitedOrg, error: invErr } = await sb.rpc("accept_invite");
        if (invErr) error = invErr;
        else if (invitedOrg) ({ data: prof, error } = await loadProfile());
      }
      if (cancelled) return;
      if (error) return setState({ kind: "error", message: error.message });
      if (!prof) return setState({ kind: "no_org", auth });
      const org = prof.organizations as unknown as { name: string; timezone: string } | null;
      setState({
        kind: "ready",
        repo: new SupabaseRepo(sb, {
          orgId: prof.org_id, orgName: org?.name ?? "", userId: auth.user.id, userName: prof.full_name,
          timezone: org?.timezone ?? DEFAULT_TZ, mode: "supabase",
          role: (prof as { role?: "admin" | "manager" | "ae" }).role,
        }),
      });
    };
    sb.auth.getSession().then(({ data }) => resolve(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((evt, s) => {
      if (evt === "SIGNED_IN" || evt === "SIGNED_OUT") void resolve(s);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [sb, reload]);

  if (state.kind === "loading") return <FullScreen>Carregando…</FullScreen>;
  if (state.kind === "error") return <FullScreen>Erro ao carregar o perfil: {state.message}</FullScreen>;
  if (state.kind === "signed_out") return <LoginScreen />;
  if (state.kind === "no_org") return <OnboardingScreen auth={state.auth} onDone={() => setReload((n) => n + 1)} />;
  return <RepoProvider value={state.repo}>{children}</RepoProvider>;
}

export function FullScreen({ children }: { children: ReactNode }) {
  return <div className="grid min-h-dvh place-items-center p-6 text-sm text-slate-400">{children}</div>;
}
