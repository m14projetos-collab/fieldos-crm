"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useRepo } from "@/lib/data/hooks";
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
  const repo = useRepo();
  const isAdmin = repo.session.role === "admin";
  const [orgName, setOrgName] = useState(repo.session.orgName);
  const [orgBusy, setOrgBusy] = useState(false);
  const saveOrg = async () => {
    if (!orgName.trim() || orgName.trim() === repo.session.orgName) return;
    setOrgBusy(true);
    try {
      await repo.updateOrgName(orgName);
      toast.success("Nome da empresa atualizado. Os scripts de WhatsApp já usam o novo nome.");
      window.location.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setOrgBusy(false);
    }
  };

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
      {isAdmin ? (
        <form className="mb-5 space-y-2 border-b border-slate-800 pb-4" onSubmit={(e) => { e.preventDefault(); void saveOrg(); }}>
          <div className="text-xs font-semibold text-slate-300">Nome da empresa (aparece nos scripts de WhatsApp)</div>
          <div className="flex gap-2">
            <input aria-label="Nome da empresa" className={input} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            <Button variant="primary" type="submit" disabled={orgBusy || !orgName.trim() || orgName.trim() === repo.session.orgName}>Salvar</Button>
          </div>
        </form>
      ) : null}
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
