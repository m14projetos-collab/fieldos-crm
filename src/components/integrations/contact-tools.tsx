"use client";
// Ferramentas de 1 clique na ficha: e-mail (Gmail/Outlook/Hotmail) com modelo e avanço automático de etapa,
// botões de agenda (Google, Outlook, .ics) e pesquisa rápida do restaurante.
import { CalendarPlus, Download, Mail } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useActions, useScriptCtx } from "@/lib/data/hooks";
import { useEmailApp, useEmailTemplates, useOrgSettings } from "@/lib/data/settings";
import { ACCOUNT_STATUS_LABEL } from "@/lib/domain/constants";
import {
  type CalEvent, EMAIL_APPS, addressOf, type EmailApp, autoAdvance, buildIcs, composeLink, fillVars, googleCalendarLink, outlookCalendarLink,
  researchLinks, suggestedEmailId,
} from "@/lib/domain/links";
import type { Account, Visit } from "@/lib/domain/types";
import { cn } from "@/components/ui/primitives";

const chip = "inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500";

export function useVarCtx() {
  const sctx = useScriptCtx();
  const { data } = useOrgSettings();
  return { seller: sctx.sellerName, company: sctx.companyName, links: data?.links };
}

export function EmailTools({ acc }: { acc: Account }) {
  const templates = useEmailTemplates();
  const { app, setApp } = useEmailApp();
  const ctx = useVarCtx();
  const actions = useActions();
  const [id, setId] = useState(templates[0]?.id ?? "");
  const t = templates.find((x) => x.id === id) ?? templates[0];
  if (!t) return null;
  const subject = fillVars(t.subject, acc, ctx);
  const body = fillVars(t.body, acc, ctx);
  const href = composeLink(app, { to: acc.email, subject, body });
  const next = autoAdvance(acc.status, t.advance_to);

  const onSend = () => {
    if (next) void actions.setAccountStatus({ accountId: acc.id, status: next }, { silent: true })
      .then((ok) => ok && toast.success(`E-mail aberto. Etapa: ${ACCOUNT_STATUS_LABEL[next]}.`));
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-800 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Modelo de e-mail" className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
          value={t.id} onChange={(e) => setId(e.target.value)}>
          {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select aria-label="App de e-mail" className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
          value={app} onChange={(e) => setApp(e.target.value as EmailApp)}>
          {EMAIL_APPS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>
      <div className="rounded-md bg-slate-900 p-2 text-[11px] leading-relaxed text-slate-300">
        <div className="font-semibold text-white">{subject}</div>
        <p className="mt-1 line-clamp-4 whitespace-pre-line">{body}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={onSend}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-onaccent hover:bg-brand-500">
          <Mail size={13} /> Abrir no {EMAIL_APPS.find((a) => a.id === app)?.label.split(" ")[0]}
        </a>
        {next ? <span className="text-[10px] text-slate-400">→ move para <b>{ACCOUNT_STATUS_LABEL[next]}</b></span> : null}
        {!acc.email ? <span className="text-[10px] text-amber-300">Sem e-mail no cadastro: o rascunho abre sem destinatário.</span> : null}
      </div>
    </div>
  );
}

/** Botão 📧 de 1 clique nos cards: modelo da etapa, abre no app do aparelho e avança a etapa quando faz sentido. */
export function QuickEmail({ acc }: { acc: Account }) {
  const templates = useEmailTemplates();
  const { app } = useEmailApp();
  const ctx = useVarCtx();
  const actions = useActions();
  const t = templates.find((x) => x.id === suggestedEmailId(acc.status)) ?? templates[0];
  if (!t) return null;
  const next = autoAdvance(acc.status, t.advance_to);
  const href = composeLink(app, { to: acc.email, subject: fillVars(t.subject, acc, ctx), body: fillVars(t.body, acc, ctx) });
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={`E-mail: ${t.name}${next ? ` (move para ${ACCOUNT_STATUS_LABEL[next]})` : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (next) void actions.setAccountStatus({ accountId: acc.id, status: next }, { silent: true })
          .then((ok) => ok && toast.success(`E-mail aberto. Etapa: ${ACCOUNT_STATUS_LABEL[next]}.`));
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-500">
      <Mail size={13} /> E-mail
    </a>
  );
}

export function downloadIcs(fileName: string, events: CalEvent[], calName?: string) {
  const blob = new Blob([buildIcs(events, calName)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Eventos de agenda para uma lista de visitas (agenda do dia, rota). */
export function visitEvents(visits: Visit[], accOf: (id: string) => Account | undefined, typeLabel: (v: Visit) => string): CalEvent[] {
  return visits.flatMap((v) => {
    const a = accOf(v.account_id);
    if (!a) return [];
    const start = new Date(v.scheduled_at);
    return [{
      uid: `visit-${v.id}`,
      title: `Visita: ${a.name}`,
      start,
      end: new Date(start.getTime() + v.duration_minutes * 60_000),
      location: addressOf(a) || undefined,
      details: `${typeLabel(v)} · ${a.decision_maker_name ?? "decisor a confirmar"} · ${a.whatsapp || a.phone || "sem telefone"}`,
    }];
  });
}

/** Botão: baixa as visitas como .ics (abre na agenda do celular com lembrete 30 min antes). */
export function DayIcsButton({ events, date, className }: { events: CalEvent[]; date: string; className?: string }) {
  if (!events.length) return null;
  return (
    <button type="button" className={cn(chip, className)} title="Baixar as visitas para a agenda do celular (Google, Outlook, iPhone)"
      onClick={() => { downloadIcs(`visitas-${date}.ics`, events, `Visitas ${date}`); toast.success(`${events.length} visita(s) no arquivo. Abra para adicionar à agenda.`); }}>
      <Download size={12} /> Agenda (.ics)
    </button>
  );
}

/** Google Agenda · Outlook · .ics para um evento (visita ou follow-up). */
export function CalendarButtons({ ev, className }: { ev: CalEvent; className?: string }) {
  const { app } = useEmailApp();
  const corp = app === "outlook365";
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      <a className={chip} href={googleCalendarLink(ev)} target="_blank" rel="noopener noreferrer" title="Adicionar ao Google Agenda">
        <CalendarPlus size={12} /> Google Agenda
      </a>
      <a className={chip} href={outlookCalendarLink(ev, corp)} target="_blank" rel="noopener noreferrer" title="Adicionar ao Outlook / Hotmail">
        <CalendarPlus size={12} /> Outlook
      </a>
      <button type="button" className={chip} onClick={() => downloadIcs(`${ev.title.replace(/[^\w\- ]+/g, "").slice(0, 40) || "evento"}.ics`, [ev])}
        title="Arquivo para a agenda do celular (iPhone, Android)">
        <Download size={12} /> .ics
      </button>
    </div>
  );
}

export function ResearchLinks({ acc }: { acc: Account }) {
  const { data } = useOrgSettings();
  return (
    <div className="flex flex-wrap gap-1.5">
      {researchLinks(acc, data?.links?.drive_folder).map((l) => (
        <a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer" className={chip}>{l.label}</a>
      ))}
    </div>
  );
}
