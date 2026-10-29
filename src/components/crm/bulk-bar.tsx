"use client";
// Ações em massa na tabela do CRM: pôr vários restaurantes na rota de um dia ou mudar o status em lote.
// Cada conta passa pelas mesmas regras (RPCs) da ação individual; o resultado diz quantas deram certo.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/primitives";
import { useActions, useRepo, useSnapshot } from "@/lib/data/hooks";
import { ACCOUNT_STATUS_LABEL } from "@/lib/domain/constants";
import { dateInTz, zonedToIso } from "@/lib/domain/dates";
import { LOSS_CATEGORIES } from "@/lib/domain/pipeline";
import type { AccountStatus, VisitType } from "@/lib/domain/types";

/** Fechado fica de fora: cada venda precisa do MRR dela (use o pipeline). */
const BULK_STATUSES: AccountStatus[] = [
  "lead_frio", "novo_lead", "a_validar", "primeiro_contato", "discovery", "agendado", "demo_realizada", "proposta_enviada", "negociacao", "perdido",
];
const SLOT_MIN = 30;

export function BulkBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const { data } = useSnapshot();
  const { session } = useRepo();
  const actions = useActions();
  const router = useRouter();
  const tz = session.timezone;
  const [date, setDate] = useState(dateInTz(new Date(), tz));
  const [status, setStatus] = useState<AccountStatus | "">("");
  const [loss, setLoss] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  if (!ids.length || !data) return null;

  const addToRoute = async () => {
    const dayVisits = data.visits.filter((v) => v.status !== "cancelada" && dateInTz(v.scheduled_at, tz) === date);
    const already = new Set(dayVisits.map((v) => v.account_id));
    const todo = ids.filter((id) => !already.has(id));
    // começa depois da última visita do dia (ou 09:00); a ordem e os horários finais saem do "Otimizar" em Rotas
    const lastEnd = dayVisits.reduce((m, v) => Math.max(m, new Date(v.scheduled_at).getTime() + v.duration_minutes * 60_000), 0);
    let t = Math.max(lastEnd, new Date(zonedToIso(date, "09:00", tz)).getTime());
    let ok = 0;
    for (const [i, id] of todo.entries()) {
      setBusy(`Agendando ${i + 1}/${todo.length}`);
      const a = data.accounts.find((x) => x.id === id);
      const type: VisitType = a?.status === "fechado" ? "pos_venda" : a && ["proposta_enviada", "negociacao"].includes(a.status) ? "retorno" : "primeiro_contato";
      if (await actions.scheduleVisit({ accountId: id, scheduledAt: new Date(t).toISOString(), visitType: type, durationMinutes: SLOT_MIN }, { silent: true })) ok++;
      t += SLOT_MIN * 60_000;
    }
    setBusy(null);
    const skipped = ids.length - todo.length;
    toast.success(`${ok} visita(s) na rota de ${date.split("-").reverse().join("/")}${skipped ? ` · ${skipped} já estavam no dia` : ""}. Agora otimize a ordem.`);
    onDone();
    router.push(`/rotas?data=${date}`);
  };

  const applyStatus = async () => {
    if (!status) return;
    if (status === "perdido" && !loss) return toast.error("Escolha o motivo da perda.");
    let ok = 0;
    for (const [i, id] of ids.entries()) {
      setBusy(`Aplicando ${i + 1}/${ids.length}`);
      const a = data.accounts.find((x) => x.id === id);
      if (a?.status === status) { ok++; continue; }
      if (await actions.setAccountStatus({ accountId: id, status, lossCategory: status === "perdido" ? loss : null }, { silent: true })) ok++;
    }
    setBusy(null);
    const fail = ids.length - ok;
    if (fail) toast.warning(`${ok} conta(s) em ${ACCOUNT_STATUS_LABEL[status]}. ${fail} recusada(s) pelas regras do funil (veja o aviso de cada uma).`);
    else toast.success(`${ok} conta(s) em ${ACCOUNT_STATUS_LABEL[status]}.`);
    onDone();
  };

  const sel = "rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white";
  return (
    <div role="region" aria-label="Ações em massa"
      className="sticky bottom-20 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/40 bg-slate-900/95 p-2.5 shadow-xl backdrop-blur md:bottom-4">
      <span className="text-xs font-bold text-white">{ids.length} selecionado(s)</span>
      <span className="flex items-center gap-1.5">
        <input aria-label="Dia da rota" type="date" className={sel} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void addToRoute()}>Adicionar à rota</Button>
      </span>
      <span className="flex items-center gap-1.5">
        <select aria-label="Novo status" className={sel} value={status} onChange={(e) => setStatus(e.target.value as AccountStatus | "")}>
          <option value="">Mudar status…</option>
          {BULK_STATUSES.map((s) => <option key={s} value={s}>{ACCOUNT_STATUS_LABEL[s]}</option>)}
        </select>
        {status === "perdido" ? (
          <select aria-label="Motivo da perda" className={sel} value={loss} onChange={(e) => setLoss(e.target.value)}>
            <option value="">Motivo…</option>
            {LOSS_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        ) : null}
        <Button size="sm" disabled={!!busy || !status} onClick={() => void applyStatus()}>Aplicar</Button>
      </span>
      <Button size="sm" variant="outline" disabled={!!busy} onClick={onDone}>Limpar</Button>
      {busy ? <span className="text-[11px] text-slate-400">{busy}…</span> : null}
    </div>
  );
}
