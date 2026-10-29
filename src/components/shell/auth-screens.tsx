"use client";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { Button, Card } from "@/components/ui/primitives";

const input =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await getSupabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  };

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="text-lg font-extrabold text-white">FieldOS <span className="text-brand-400">CRM</span></div>
          <p className="text-xs text-slate-400">Entre com seu e-mail. Enviamos um link de acesso, sem senha.</p>
        </div>
        {sent ? (
          <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">Link enviado para {email}. Abra no mesmo aparelho.</p>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input className={input} type="email" required autoComplete="email" placeholder="voce@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button variant="primary" className="w-full" disabled={busy || !email} type="submit">Enviar link de acesso</Button>
            {err ? <p className="text-xs text-red-400">{err}</p> : null}
          </form>
        )}
      </Card>
    </div>
  );
}

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

export function OnboardingScreen({ auth, onDone }: { auth: AuthSession; onDone: () => void }) {
  const [org, setOrg] = useState("");
  const [name, setName] = useState((auth.user.user_metadata?.full_name as string) ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setErr(null);
    const slug = `${slugify(org) || "org"}-${auth.user.id.slice(0, 6)}`;
    const { error } = await getSupabase().rpc("create_organization", { p_name: org, p_slug: slug, p_full_name: name });
    setBusy(false);
    if (error) setErr(error.message);
    else onDone();
  };

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="text-lg font-bold text-white">Criar seu espaço</div>
          <p className="text-xs text-slate-400">Cada empresa tem dados isolados. Você será o administrador.</p>
        </div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <input className={input} required placeholder="Empresa (ex.: Takeat Zona Oeste)" value={org} onChange={(e) => setOrg(e.target.value)} />
          <input className={input} required placeholder="Seu nome" value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="primary" className="w-full" disabled={busy || !org || !name} type="submit">Criar e entrar</Button>
          {err ? <p className="text-xs text-red-400">{err}</p> : null}
        </form>
      </Card>
    </div>
  );
}
