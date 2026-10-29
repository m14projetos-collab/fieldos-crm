"use client";
// Quick Log de estacionamento: 1 toque no resultado + 1 toque em Confirmar.
// Atualiza visita, conta, pipeline e cria o próximo follow-up numa única ação atômica.
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button, cn } from "@/components/ui/primitives";
import { CHANNEL_LABEL, OUTCOME_DEFAULTS, OUTCOME_LABEL } from "@/lib/domain/constants";
import { addDays, dateInTz, formatDateBR, timeInTz } from "@/lib/domain/dates";
import type { FollowUpChannel, VisitOutcome } from "@/lib/domain/types";
import { useActions, useRepo, useSnapshot } from "@/lib/data/hooks";
import { useUi } from "@/lib/ui-store";

const OUTCOMES: { key: VisitOutcome; cls: string; effect: string }[] = [
  { key: "interesse_confirmado", cls: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200", effect: "Discovery · oportunidade qualificada" },
  { key: "proposta_solicitada", cls: "border-amber-500/50 bg-amber-500/10 text-amber-200", effect: "Demo realizada · enviar proposta" },
  { key: "retorno_necessario", cls: "border-sky-500/50 bg-sky-500/10 text-sky-200", effect: "Mantém etapa · agenda retorno" },
  { key: "fechado", cls: "border-brand-500/60 bg-brand-500/10 text-brand-200", effect: "Fechado · pós-venda 7 dias" },
  { key: "sem_interesse", cls: "border-slate-600 bg-slate-800/60 text-slate-300", effect: "Perdido · recuperação em 90 dias" },
];
const CHANNELS: FollowUpChannel[] = ["whatsapp", "ligacao", "visita", "proposta", "email"];
const DAYS = [1, 2, 3, 5, 7, 15, 30, 90];

export function QuickLogDialog() {
  const { quickLog, closeQuickLog, openQuickLog } = useUi();
  const { data } = useSnapshot();
  const { session } = useRepo();
  const actions = useActions();
  const tz = session.timezone;

  const [outcome, setOutcome] = useState<VisitOutcome | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [channel, setChannel] = useState<FollowUpChannel | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (quickLog.open) {
      setOutcome(null); setDays(null); setChannel(null); setNotes("");
    }
  }, [quickLog.open, quickLog.visitId]);

  const today = dateInTz(new Date(), tz);
  const pendingVisits = useMemo(
    () =>
      (data?.visits ?? [])
        .filter((v) => (v.status === "agendada" || v.status === "em_andamento") && dateInTz(v.scheduled_at, tz) <= today)
        .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    [data, tz, today],
  );
  const visit = data?.visits.find((v) => v.id === quickLog.visitId) ?? null;
  const account = visit ? data?.accounts.find((a) => a.id === visit.account_id) : null;
  const def = outcome ? OUTCOME_DEFAULTS[outcome] : null;
  const effDays = days ?? def?.days ?? 0;
  const effChannel = channel ?? def?.channel ?? "whatsapp";

  const confirm = async () => {
    if (!visit || !outcome) return;
    setBusy(true);
    const ok = await actions.logVisitOutcome({ visitId: visit.id, outcome, nextInDays: days, nextChannel: channel, notes });
    setBusy(false);
    if (ok) closeQuickLog();
  };

  // Sem visita escolhida: lista as visitas pendentes (de hoje e atrasadas)
  if (quickLog.open && !visit) {
    return (
      <Modal open onOpenChange={(o) => !o && closeQuickLog()} title="Check-in de visita" description="Qual visita você acabou de fazer?">
        {pendingVisits.length ? (
          <ul className="space-y-2">
            {pendingVisits.map((v) => {
              const a = data?.accounts.find((x) => x.id === v.account_id);
              const late = dateInTz(v.scheduled_at, tz) < today;
              return (
                <li key={v.id}>
                  <button type="button" onClick={() => openQuickLog(v.id)}
                    className="flex w-full items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 p-3 text-left hover:border-slate-500">
                    <span className="font-mono text-xs text-slate-400">{late ? formatDateBR(dateInTz(v.scheduled_at, tz)) : timeInTz(v.scheduled_at, tz)}</span>
                    <span className="flex-1 truncate text-sm font-semibold text-white">{a?.name}</span>
                    <span className="text-xs text-slate-500">{a?.neighborhood}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">Nenhuma visita pendente. Agende uma pela busca (Ctrl+K).</p>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      open={quickLog.open && !!visit}
      onOpenChange={(o) => !o && closeQuickLog()}
      title={account ? `Como foi na ${account.name}?` : "Check-in"}
      description={visit ? `${timeInTz(visit.scheduled_at, tz)} · ${account?.neighborhood ?? ""}` : undefined}
      footer={
        <>
          <Button onClick={closeQuickLog}>Cancelar</Button>
          <Button variant="success" disabled={!outcome || busy} onClick={confirm}>Confirmar check-in</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {OUTCOMES.map((o) => (
          <button key={o.key} type="button" onClick={() => { setOutcome(o.key); setDays(null); setChannel(null); }}
            aria-pressed={outcome === o.key}
            className={cn(
              "rounded-xl border p-3 text-left transition",
              outcome === o.key ? cn(o.cls, "ring-2 ring-white/30") : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500",
              o.key === "sem_interesse" && "sm:col-span-2",
            )}>
            <div className="text-sm font-bold">{OUTCOME_LABEL[o.key]}</div>
            <div className="text-[11px] opacity-70">{o.effect}</div>
          </button>
        ))}
      </div>

      {def ? (
        <div className="anim-fade mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
          <div className="text-xs text-slate-300">
            Próximo follow-up: <b className="text-white">{def.title}</b> em <b className="text-white">{formatDateBR(addDays(today, effDays))}</b> por <b className="text-white">{CHANNEL_LABEL[effChannel]}</b>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)}
                className={cn("rounded-md px-2 py-1 text-[11px] font-semibold", effDays === d ? "bg-brand-600 text-onaccent" : "bg-slate-800 text-slate-300")}>
                +{d}d
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CHANNELS.map((c) => (
              <button key={c} type="button" onClick={() => setChannel(c)}
                className={cn("rounded-md px-2 py-1 text-[11px] font-semibold", effChannel === c ? "bg-brand-600 text-onaccent" : "bg-slate-800 text-slate-300")}>
                {CHANNEL_LABEL[c]}
              </button>
            ))}
          </div>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nota rápida (opcional)"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none" />
        </div>
      ) : null}
    </Modal>
  );
}
