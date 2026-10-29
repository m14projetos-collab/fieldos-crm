"use client";
// Gaveta 360º: abre de qualquer tela, sem recarregar, com tudo da conta num lugar.
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarPlus, MessageCircle, Navigation, Pencil, Phone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { FollowUpRow } from "@/components/hoje/follow-up-row";
import { Badge, Button, SectionTitle, cn, scoreColor } from "@/components/ui/primitives";
import { cadenceScript, followUpScript, mapsLink, waLink } from "@/lib/domain/cadence";
import {
  ACCOUNT_STATUS_LABEL, INTEREST_LABEL, MISSING_FIELD_LABEL, NEXT_BEST_ACTION_LABEL, OUTCOME_LABEL, PERSONA_LABEL,
  PRIORITY_LABEL, STAGE_LABEL, VISIT_TYPE_LABEL,
} from "@/lib/domain/constants";
import { brl, dateInTz, formatDateBR, timeInTz } from "@/lib/domain/dates";
import type { EnrichedAccount } from "@/lib/domain/enrich";
import type { Account, Interest, Persona, Priority } from "@/lib/domain/types";
import { useActions, useEnriched, useRepo, useScriptCtx, useSnapshot } from "@/lib/data/hooks";
import { useUi } from "@/lib/ui-store";
import { PainCalculator } from "./pain-calculator";

export function AccountDrawer() {
  const { drawerAccountId, closeDrawer, openSchedule } = useUi();
  const { data } = useSnapshot();
  const enriched = useEnriched(data);
  const { session } = useRepo();
  const sctx = useScriptCtx();
  const acc = drawerAccountId ? (enriched.get(drawerAccountId) as EnrichedAccount | undefined) : undefined;
  const tz = session.timezone;
  const today = dateInTz(new Date(), tz);

  const visits = (data?.visits ?? []).filter((v) => v.account_id === drawerAccountId).sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
  const opps = (data?.opportunities ?? []).filter((o) => o.account_id === drawerAccountId);
  const nextFu = acc?.next_followup ?? null;
  const fuVisit = nextFu?.visit_id ? data?.visits.find((v) => v.id === nextFu.visit_id) : undefined;
  const script = acc ? (nextFu ? followUpScript(nextFu, acc, sctx, fuVisit) : cadenceScript(acc.cadence_day, acc, sctx)) : "";
  const wa = acc ? waLink(acc.whatsapp || acc.phone, script) : null;
  const phone = acc ? (acc.phone || acc.whatsapp || "").replace(/\D/g, "") : "";

  return (
    <Dialog.Root open={!!acc} onOpenChange={(o) => !o && closeDrawer()}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-40 bg-black/50" />
        <Dialog.Content className="anim-drawer fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-800 bg-slate-950 shadow-2xl">
          {acc ? (
            <>
              <header className="flex items-start gap-3 border-b border-slate-800 p-4">
                <div className="min-w-0 flex-1">
                  <Dialog.Title className="truncate text-lg font-bold text-white">{acc.name}</Dialog.Title>
                  <Dialog.Description className="mt-1 flex flex-wrap gap-1.5">
                    <Badge>{ACCOUNT_STATUS_LABEL[acc.status]}</Badge>
                    <Badge>{PRIORITY_LABEL[acc.priority]}</Badge>
                    <Badge>Interesse {INTEREST_LABEL[acc.interest_level]}</Badge>
                  </Dialog.Description>
                </div>
                <div className={cn("rounded-xl px-3 py-1.5 text-center", scoreColor(acc.commercial_score))}>
                  <div className="font-mono text-xl font-extrabold leading-none">{acc.commercial_score}</div>
                  <div className="text-[9px] uppercase">score</div>
                </div>
                <Dialog.Close className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Fechar"><X size={18} /></Dialog.Close>
              </header>

              <div className="flex-1 space-y-5 overflow-y-auto p-4">
                <div className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-3">
                  <div className="text-[11px] font-semibold uppercase text-brand-300">Próxima melhor ação</div>
                  <div className="text-sm font-bold text-white">{NEXT_BEST_ACTION_LABEL[acc.next_best_action]}</div>
                  {acc.missing_field ? (
                    <div className="mt-1 text-xs text-amber-300">⚠️ Cadastro incompleto: falta {MISSING_FIELD_LABEL[acc.missing_field]}</div>
                  ) : (
                    <div className="mt-1 text-xs text-emerald-300">✅ Cadastro completo</div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {wa ? (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/25">
                      <MessageCircle size={15} /> WhatsApp
                    </a>
                  ) : <Button disabled><MessageCircle size={15} /> Sem WhatsApp</Button>}
                  {phone ? (
                    <a href={`tel:${phone}`} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800/70 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"><Phone size={15} /> Ligar</a>
                  ) : <Button disabled><Phone size={15} /> Sem telefone</Button>}
                  <Button onClick={() => openSchedule(acc.id)}><CalendarPlus size={15} /> Agendar visita</Button>
                  {mapsLink(acc) ? (
                    <a href={mapsLink(acc)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800/70 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"><Navigation size={15} /> Mapa</a>
                  ) : <Button disabled><Navigation size={15} /> Sem endereço</Button>}
                </div>
                {wa ? <p className="rounded-lg bg-slate-900 p-2.5 text-[11px] leading-relaxed text-slate-400">“{script}”</p> : null}

                <section>
                  <SectionTitle>Próxima ação (follow-up)</SectionTitle>
                  {nextFu ? (
                    <ul><FollowUpRow fu={nextFu} account={acc} visit={fuVisit} today={today} showAccount={false} /></ul>
                  ) : (
                    <p className="text-xs text-slate-400">Nenhuma. {acc.status === "fechado" || acc.status === "perdido" ? "" : "Contas em negociação precisam de uma: agende uma visita ou registre um contato."}</p>
                  )}
                </section>

                <AccountData acc={acc} />

                <PainCalculator acc={acc} />

                <section>
                  <SectionTitle>Oportunidades ({opps.length})</SectionTitle>
                  {opps.length ? (
                    <ul className="space-y-1.5">
                      {opps.map((o) => (
                        <li key={o.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs">
                          <span className="min-w-0 truncate text-slate-200">{o.title}</span>
                          <span className="shrink-0 text-slate-400">{STAGE_LABEL[o.stage]} · {brl(Number(o.mrr_value))} · {o.probability}%</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-xs text-slate-400">Nenhuma. O Quick Log cria a oportunidade quando há interesse.</p>}
                </section>

                <section>
                  <SectionTitle>Histórico de visitas ({visits.length})</SectionTitle>
                  {visits.length ? (
                    <ul className="space-y-1.5">
                      {visits.map((v) => (
                        <li key={v.id} className="rounded-lg bg-slate-900 px-3 py-2 text-xs">
                          <div className="flex justify-between gap-2 text-slate-300">
                            <span>{formatDateBR(dateInTz(v.scheduled_at, tz))} {timeInTz(v.scheduled_at, tz)} · {VISIT_TYPE_LABEL[v.visit_type]}</span>
                            <span className="text-slate-400">{v.outcome ? OUTCOME_LABEL[v.outcome] : v.status}</span>
                          </div>
                          {v.checkin_notes ? <div className="mt-1 text-slate-500">{v.checkin_notes}</div> : null}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-xs text-slate-400">Nenhuma visita ainda.</p>}
                </section>
              </div>
            </>
          ) : (
            <Dialog.Title className="sr-only">Conta</Dialog.Title>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const field = "w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white focus:border-brand-500 focus:outline-none";

function AccountData({ acc }: { acc: Account }) {
  const actions = useActions();
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Partial<Account>>({});
  useEffect(() => { setEdit(false); setForm({}); }, [acc.id]);
  const v = <K extends keyof Account>(k: K) => (k in form ? form[k] : acc[k]) as Account[K];
  const set = <K extends keyof Account>(k: K, val: Account[K]) => setForm((f) => ({ ...f, [k]: val }));

  const rows: [string, keyof Account][] = [
    ["WhatsApp", "whatsapp"], ["Telefone", "phone"], ["Decisor", "decision_maker_name"], ["Endereço", "address"],
    ["Bairro", "neighborhood"], ["Região", "region"], ["Cidade", "city"], ["Segmento", "segment"], ["Sistema atual", "current_system"],
  ];

  const save = async () => {
    const patch: Partial<Account> = {};
    for (const [k, val] of Object.entries(form)) {
      (patch as Record<string, unknown>)[k] = typeof val === "string" ? val.trim() || null : val;
    }
    const ok = await actions.updateAccount(acc.id, patch, "Cadastro atualizado.");
    if (ok) { setEdit(false); setForm({}); }
  };

  return (
    <section>
      <SectionTitle right={!edit ? <Button size="sm" onClick={() => setEdit(true)}><Pencil size={12} /> Editar</Button> : null}>
        Dados do cliente (fonte única)
      </SectionTitle>
      {edit ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {rows.map(([label, k]) => (
              <label key={k} className="space-y-0.5 text-[11px] text-slate-400">
                {label}
                <input className={field} value={(v(k) as string | null) ?? ""} onChange={(e) => set(k, e.target.value as never)} />
              </label>
            ))}
            <label className="space-y-0.5 text-[11px] text-slate-400">Persona
              <select className={field} value={v("persona")} onChange={(e) => set("persona", e.target.value as Persona)}>
                {Object.entries(PERSONA_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="space-y-0.5 text-[11px] text-slate-400">Prioridade
              <select className={field} value={v("priority")} onChange={(e) => set("priority", e.target.value as Priority)}>
                {Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="space-y-0.5 text-[11px] text-slate-400">Interesse
              <select className={field} value={v("interest_level")} onChange={(e) => set("interest_level", e.target.value as Interest)}>
                {Object.entries(INTEREST_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => { setEdit(false); setForm({}); }}>Cancelar</Button>
            <Button size="sm" variant="primary" onClick={save} disabled={!Object.keys(form).length}>Salvar</Button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          {rows.map(([label, k]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[10px] uppercase text-slate-500">{label}</dt>
              <dd className="truncate text-slate-200">{(acc[k] as string | null) || <span className="text-slate-600">—</span>}</dd>
            </div>
          ))}
          <div><dt className="text-[10px] uppercase text-slate-500">Persona</dt><dd className="text-slate-200">{PERSONA_LABEL[acc.persona]}</dd></div>
        </dl>
      )}
    </section>
  );
}
