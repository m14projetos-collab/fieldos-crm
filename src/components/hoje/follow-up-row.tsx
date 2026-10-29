"use client";
import { Check, MessageCircle, Phone } from "lucide-react";
import { useState } from "react";
import { Badge, Button, cn } from "@/components/ui/primitives";
import { CHANNEL_LABEL, nextCadenceStep } from "@/lib/domain/constants";
import { followUpScript, waLink, waNumber } from "@/lib/domain/cadence";
import { relativeDayLabel } from "@/lib/domain/dates";
import type { Account, FollowUp, Visit } from "@/lib/domain/types";
import { useActions, useScriptCtx } from "@/lib/data/hooks";
import { useUi } from "@/lib/ui-store";

export function FollowUpRow({
  fu, account, visit, today, showAccount = true,
}: { fu: FollowUp; account: Account; visit?: Visit; today: string; showAccount?: boolean }) {
  const [open, setOpen] = useState(false);
  const actions = useActions();
  const sctx = useScriptCtx();
  const openDrawer = useUi((s) => s.openDrawer);
  const overdue = fu.due_date < today;
  const text = followUpScript(fu, account, sctx, visit);
  const wa = waLink(waNumber(account), text);
  const nextStep = fu.cadence_step != null ? nextCadenceStep(fu.cadence_step) : null;

  const done = async (nextInDays: number | null, result: "concluido" | "sem_resposta" = "concluido") => {
    const ok = await actions.completeFollowUp({ followUpId: fu.id, result, nextInDays });
    if (ok) setOpen(false);
  };

  return (
    <li className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {showAccount ? (
            <button type="button" onClick={() => openDrawer(account.id)} title="Abrir ficha" className="block max-w-full truncate text-left text-sm font-semibold text-white underline decoration-slate-600 decoration-dotted underline-offset-2 hover:text-brand-300">
              {account.name}
            </button>
          ) : null}
          <div className="truncate text-xs text-slate-400">{fu.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge className={cn(overdue && "bg-red-500/15 text-red-300")}>{relativeDayLabel(fu.due_date, today)}</Badge>
            <Badge>{CHANNEL_LABEL[fu.channel]}</Badge>
            {fu.cadence_step != null ? <Badge className="bg-indigo-500/15 text-indigo-300">Cadência D{fu.cadence_step}</Badge> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {wa ? (
            <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="Enviar WhatsApp"
              className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25">
              <MessageCircle size={16} />
            </a>
          ) : null}
          {fu.channel === "ligacao" && (account.phone || account.whatsapp) ? (
            <a href={`tel:${(account.phone || account.whatsapp || "").replace(/\D/g, "")}`} aria-label="Ligar"
              className="grid h-9 w-9 place-items-center rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700">
              <Phone size={16} />
            </a>
          ) : null}
          <Button size="sm" variant={open ? "outline" : "ghost"} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            <Check size={14} /> Feito
          </Button>
        </div>
      </div>
      {open ? (
        <div className="anim-fade mt-3 border-t border-slate-800 pt-3">
          <div className="mb-2 text-[11px] text-slate-400">Feito. Qual a próxima ação?</div>
          <div className="flex flex-wrap gap-1.5">
            {nextStep != null ? (
              <Button size="sm" variant="primary" onClick={() => done(nextStep - (fu.cadence_step ?? 0))}>
                Cadência Dia {nextStep} (em {nextStep - (fu.cadence_step ?? 0)}d)
              </Button>
            ) : null}
            {[1, 2, 5, 7].map((d) => (
              <Button key={d} size="sm" onClick={() => done(d)}>+{d}d</Button>
            ))}
            <Button size="sm" variant="outline" onClick={() => done(2, "sem_resposta")}>Sem resposta (+2d)</Button>
            <Button size="sm" variant="outline" onClick={() => done(null)}>Sem próxima ação</Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
