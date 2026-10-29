"use client";
// Mover no Kanban (arrastar OU menu). Etapas que exigem dado pedem aqui: Fechado → MRR, Perdido → motivo.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useActions, useSnapshot } from "@/lib/data/hooks";
import { ACCOUNT_STATUS_LABEL, STAGE_LABEL } from "@/lib/domain/constants";
import { LOSS_CATEGORIES } from "@/lib/domain/pipeline";
import { type MoveRequest, useUi } from "@/lib/ui-store";

const field = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-brand-500 focus:outline-none";

const needsInput = (m: MoveRequest) => m.target === "fechado" || m.target === "perdido";

/** Pede o movimento: executa direto quando não precisa de dado extra. */
export function useMover() {
  const actions = useActions();
  const setMove = useUi((s) => s.setMove);
  return (m: MoveRequest) => {
    if (needsInput(m)) return setMove(m);
    if (m.kind === "opp") void actions.moveOpportunity({ oppId: m.id, stage: m.target });
    else void actions.setAccountStatus({ accountId: m.id, status: m.target });
  };
}

export function MoveDialog() {
  const { move, setMove } = useUi();
  const { data } = useSnapshot();
  const actions = useActions();
  const [mrr, setMrr] = useState("");
  const [loss, setLoss] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  const opp = move?.kind === "opp" ? data?.opportunities.find((o) => o.id === move.id) : move?.kind === "account"
    ? data?.opportunities.filter((o) => o.account_id === move.id && o.stage !== "fechado" && o.stage !== "perdido")[0]
    : undefined;
  const accId = move?.kind === "account" ? move.id : opp?.account_id;
  const acc = data?.accounts.find((a) => a.id === accId);

  useEffect(() => {
    setMrr(opp && opp.mrr_value > 0 ? String(opp.mrr_value) : "");
    setLoss("");
    setDetail("");
  }, [move, opp]);

  if (!move) return null;
  const closing = move.target === "fechado";
  const label = move.kind === "opp" ? STAGE_LABEL[move.target] : ACCOUNT_STATUS_LABEL[move.target];
  const mrrNum = Number(mrr.replace(/\./g, "").replace(",", "."));
  const valid = closing ? mrrNum > 0 : !!loss;

  const submit = async () => {
    setBusy(true);
    let ok: boolean;
    if (move.kind === "opp")
      ok = await actions.moveOpportunity({
        oppId: move.id, stage: move.target, mrr: closing ? mrrNum : null,
        lossCategory: closing ? null : loss, lossDetail: closing ? null : detail,
      });
    else
      ok = await actions.setAccountStatus({
        accountId: move.id, status: move.target, mrr: closing ? mrrNum : null, lossCategory: closing ? null : loss,
      });
    setBusy(false);
    if (ok) setMove(null);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && setMove(null)}
      title={closing ? "Fechar venda 🎉" : "Marcar como perdido"}
      description={`${acc?.name ?? ""} → ${label}`}
      footer={
        <>
          <Button variant="outline" onClick={() => setMove(null)}>Cancelar</Button>
          <Button variant={closing ? "success" : "primary"} disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? "Salvando…" : closing ? "Confirmar venda" : "Confirmar perda"}
          </Button>
        </>
      }
    >
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) void submit(); }}>
        {closing ? (
          <>
            <label className="block space-y-1 text-xs text-slate-300">
              MRR (mensalidade fechada, R$)
              <input className={field} inputMode="decimal" autoFocus placeholder="Ex.: 289" value={mrr} onChange={(e) => setMrr(e.target.value)} />
            </label>
            <p className="text-[11px] text-slate-400">Conta vira cliente (onboarding) e o pós-venda de 7 dias entra como única próxima ação. Meta de vendas e MRR somam na hora.</p>
          </>
        ) : (
          <>
            <label className="block space-y-1 text-xs text-slate-300">
              Motivo da perda
              <select className={field} autoFocus value={loss} onChange={(e) => setLoss(e.target.value)}>
                <option value="">Escolha…</option>
                {LOSS_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
            {move.kind === "opp" ? (
              <label className="block space-y-1 text-xs text-slate-300">
                Detalhe (opcional)
                <input className={field} placeholder="O que ele disse, em uma frase" value={detail} onChange={(e) => setDetail(e.target.value)} />
              </label>
            ) : null}
            <p className="text-[11px] text-slate-400">A recuperação em 90 dias (Central de Recuperação) substitui as ações pendentes.</p>
          </>
        )}
      </form>
    </Modal>
  );
}
