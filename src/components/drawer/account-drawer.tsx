"use client";
// Gaveta 360º: abre de qualquer tela, sem recarregar, com tudo da conta num lugar.
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarPlus, MessageCircle, Navigation, Pencil, Phone, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { icpResult } from "@/lib/domain/chave";
import { FollowUpRow } from "@/components/hoje/follow-up-row";
import { Badge, Button, SectionTitle, cn, scoreColor } from "@/components/ui/primitives";
import { cadenceScript, followUpScript, waLink, waNumber } from "@/lib/domain/cadence";
import {
  ACCOUNT_STATUS_LABEL, INTEREST_LABEL, MISSING_FIELD_LABEL, NEXT_BEST_ACTION_LABEL, OUTCOME_LABEL, PERSONA_LABEL,
  PRIORITY_LABEL, VISIT_TYPE_LABEL,
} from "@/lib/domain/constants";
import { dateInTz, formatDateBR, timeInTz } from "@/lib/domain/dates";
import type { EnrichedAccount } from "@/lib/domain/enrich";
import type { Account, Interest, Persona, Priority } from "@/lib/domain/types";
import { useActions, useEnriched, useRepo, useScriptCtx, useSnapshot } from "@/lib/data/hooks";
import { useUi } from "@/lib/ui-store";
import { useNavApp } from "@/lib/data/settings";
import { navLink } from "@/lib/domain/integrations";
import { PainCalculator } from "./pain-calculator";
import { PipelinePanel } from "./pipeline-panel";
import { RecommendedScript } from "./recommended-script";
import { WaTemplates } from "@/components/integrations/wa-templates";
import { CalendarButtons, EmailTools, ResearchLinks } from "@/components/integrations/contact-tools";
import { type CalEvent, addressOf } from "@/lib/domain/links";

export function AccountDrawer() {
  const { drawerAccountId, closeDrawer, openSchedule } = useUi();
  const docked = useDocked();
  const { data } = useSnapshot();
  const enriched = useEnriched(data);
  const { session } = useRepo();
  const sctx = useScriptCtx();
  const navApp = useNavApp((x) => x.app);
  const acc = drawerAccountId ? (enriched.get(drawerAccountId) as EnrichedAccount | undefined) : undefined;
  const tz = session.timezone;
  const today = dateInTz(new Date(), tz);

  const visits = (data?.visits ?? []).filter((v) => v.account_id === drawerAccountId).sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
  const opps = (data?.opportunities ?? []).filter((o) => o.account_id === drawerAccountId);
  const nextFu = acc?.next_followup ?? null;
  const fuVisit = nextFu?.visit_id ? data?.visits.find((v) => v.id === nextFu.visit_id) : undefined;
  const script = acc ? (nextFu ? followUpScript(nextFu, acc, sctx, fuVisit) : cadenceScript(acc.cadence_day, acc, sctx)) : "";
  const wa = acc ? waLink(waNumber(acc), script) : null;
  const phone = acc ? (acc.phone || acc.whatsapp || "").replace(/\D/g, "") : "";
  const nextVisit = visits.filter((v) => (v.status === "agendada" || v.status === "reagendada") && v.scheduled_at >= new Date(Date.now() - 3_600_000).toISOString())
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
  const calEvent: CalEvent | null = !acc ? null : nextVisit
    ? {
        uid: `visit-${nextVisit.id}`,
        title: `Visita: ${acc.name}`,
        start: new Date(nextVisit.scheduled_at),
        end: new Date(new Date(nextVisit.scheduled_at).getTime() + nextVisit.duration_minutes * 60_000),
        location: addressOf(acc) || undefined,
        details: `${VISIT_TYPE_LABEL[nextVisit.visit_type]} · ${acc.decision_maker_name ?? "decisor a confirmar"} · ${acc.whatsapp || acc.phone || "sem telefone"}`,
      }
    : nextFu
      ? {
          uid: `fu-${nextFu.id}`,
          title: `Follow-up: ${acc.name}`,
          start: new Date(`${nextFu.due_date}T09:00:00-03:00`),
          end: new Date(`${nextFu.due_date}T09:15:00-03:00`),
          details: `${nextFu.title} · ${acc.whatsapp || acc.phone || "sem telefone"}`,
        }
      : null;

  return (
    // Desktop largo (xl): inspetor fixo à direita, sem modal, o conteúdo encolhe e segue clicável (trocar de lead troca a ficha).
    // Celular/tablet: gaveta modal por cima.
    <Dialog.Root open={!!acc} modal={!docked} onOpenChange={(o) => !o && closeDrawer()}>
      <Dialog.Portal>
        {!docked ? <Dialog.Overlay className="anim-fade fixed inset-0 z-40 bg-black/50" /> : null}
        <Dialog.Content
          onInteractOutside={(e) => { if (docked) e.preventDefault(); }}
          onOpenAutoFocus={(e) => { if (docked) e.preventDefault(); }}
          className={cn("anim-drawer fixed right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-800 bg-slate-950 shadow-2xl",
            docked ? "inset-y-0 shadow-none" : "inset-y-0")}>
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
                  {navLink(navApp, acc) ? (
                    <a href={navLink(navApp, acc)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-800/70 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700"><Navigation size={15} /> Mapa</a>
                  ) : <Button disabled><Navigation size={15} /> Sem endereço</Button>}
                </div>
                {wa ? <p className="rounded-lg bg-slate-900 p-2.5 text-[11px] leading-relaxed text-slate-400">“{script}”</p> : null}
                <details className="rounded-lg bg-slate-900/60 p-2">
                  <summary className="cursor-pointer text-[11px] font-semibold text-slate-300">💬 Outros modelos de WhatsApp</summary>
                  <div className="mt-2"><WaTemplates acc={acc} /></div>
                </details>
                <details className="rounded-lg bg-slate-900/60 p-2">
                  <summary className="cursor-pointer text-[11px] font-semibold text-slate-300">📧 E-mail (Gmail, Hotmail, Outlook)</summary>
                  <div className="mt-2"><EmailTools acc={acc} /></div>
                </details>
                {calEvent ? (
                  <div className="space-y-1.5 rounded-lg bg-slate-900/60 p-2.5">
                    <div className="text-[11px] font-semibold text-slate-300">📅 {calEvent.title.split(":")[0]} na sua agenda</div>
                    <CalendarButtons ev={calEvent} />
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-400">🔎 Pesquisar antes da visita</div>
                  <ResearchLinks acc={acc} />
                </div>

                <section>
                  <SectionTitle>Próxima ação (follow-up)</SectionTitle>
                  {nextFu ? (
                    <ul><FollowUpRow fu={nextFu} account={acc} visit={fuVisit} today={today} showAccount={false} /></ul>
                  ) : (
                    <p className="text-xs text-slate-400">Nenhuma. {acc.status === "fechado" || acc.status === "perdido" ? "" : "Contas em negociação precisam de uma: agende uma visita ou registre um contato."}</p>
                  )}
                </section>

                <RecommendedScript acc={acc} playbooks={data?.playbooks ?? []} />

                <AccountData acc={acc} />

                <PainCalculator acc={acc} />

                <PipelinePanel acc={acc} opps={opps} />

                <div className="grid grid-cols-2 gap-2">
                  <Link href={`/chave?conta=${acc.id}`} onClick={closeDrawer} className="rounded-lg border border-slate-700 px-3 py-2 text-center text-xs font-semibold text-slate-200 hover:border-slate-500">
                    🧭 Qualificar (ICP){icpResult(acc.icp_checklist).verdict === "nutricao" ? " · nutrição" : ""}
                  </Link>
                  <Link href={`/chave?conta=${acc.id}&aba=auditar`} onClick={closeDrawer} className="rounded-lg border border-slate-700 px-3 py-2 text-center text-xs font-semibold text-slate-200 hover:border-slate-500">
                    🔑 Auditar conversa (CHAVE)
                  </Link>
                </div>

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
    ["E-mail", "email"], ["Instagram", "instagram_url"], ["Site / cardápio", "website_url"],
  ];
  const linkFor = (k: keyof Account, val: string) =>
    k === "email" ? `mailto:${val}` : k === "instagram_url" || k === "website_url" ? (/^https?:\/\//.test(val) ? val : `https://${val}`) : null;

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
          <label className="block space-y-0.5 text-[11px] text-slate-400">Notas / inteligência comercial
            <textarea className={cn(field, "min-h-28")} value={v("notes") ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </label>
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
              <dd className="truncate text-slate-200">
                {(() => {
                  const val = acc[k] as string | null | undefined;
                  if (!val) return <span className="text-slate-600">—</span>;
                  const href = linkFor(k, val);
                  return href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-300 hover:underline">
                      {val.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : val;
                })()}
              </dd>
            </div>
          ))}
          <div><dt className="text-[10px] uppercase text-slate-500">Persona</dt><dd className="text-slate-200">{PERSONA_LABEL[acc.persona]}</dd></div>
          {acc.notes ? (
            <div className="col-span-2 mt-1">
              <dt className="text-[10px] uppercase text-slate-500">Notas / inteligência comercial</dt>
              <dd className="whitespace-pre-line rounded-lg bg-slate-900 p-2.5 text-[11px] leading-relaxed text-slate-300">{acc.notes}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </section>
  );
}

/** true em telas ≥ 1280px: a ficha 360º vira painel fixo à direita. */
export function useDocked() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** Aba lateral sempre visível no desktop largo: reabre a última ficha. */
export function InspectorTab() {
  const { drawerAccountId, lastDrawerAccountId, openDrawer, setPalette } = useUi();
  if (drawerAccountId) return null;
  return (
    <button type="button" onClick={() => (lastDrawerAccountId ? openDrawer(lastDrawerAccountId) : setPalette(true))}
      title={lastDrawerAccountId ? "Reabrir a última ficha" : "Buscar um restaurante para abrir a ficha"}
      className="fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 rounded-l-lg border border-r-0 border-slate-700 bg-slate-900 px-1.5 py-3 text-[11px] font-semibold text-slate-300 shadow-lg [writing-mode:vertical-rl] hover:text-white xl:block">
      Ficha 360º
    </button>
  );
}
