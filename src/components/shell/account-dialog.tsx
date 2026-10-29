"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { getSupabase } from "@/lib/supabase/client";
import { translateAuthError } from "./auth-screens";

const input =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none";

/** Conta: trocar senha e sair. Só existe no modo Supabase. */
export function AccountDialog({ open, onOpenChange, userName }: { open: boolean; onOpenChange: (o: boolean) => void; userName: string }) {
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    if (pwd.length < 8) return setErr("A senha precisa ter pelo menos 8 caracteres.");
    if (pwd !== pwd2) return setErr("As senhas não conferem.");
    setBusy(true);
    const { error } = await getSupabase().auth.updateUser({ password: pwd });
    setBusy(false);
    if (error) return setErr(translateAuthError(error.message));
    setPwd("");
    setPwd2("");
    toast.success("Senha alterada");
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Minha conta" description={userName}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="text-xs font-semibold text-slate-300">Trocar senha</div>
        <input className={input} type="password" autoComplete="new-password" placeholder="Nova senha (mín. 8)" value={pwd} onChange={(e) => setPwd(e.target.value)} />
        <input className={input} type="password" autoComplete="new-password" placeholder="Repita a nova senha" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
        {err ? <p className="text-xs text-red-400">{err}</p> : null}
        <div className="flex justify-between gap-2 pt-2">
          <Button variant="outline" onClick={() => void getSupabase().auth.signOut()}>Sair</Button>
          <Button variant="primary" type="submit" disabled={busy || !pwd}>{busy ? "Salvando…" : "Salvar senha"}</Button>
        </div>
      </form>
    </Modal>
  );
}
