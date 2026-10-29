"use client";
// Integrações gratuitas sem login extra: e-mail (Gmail/Hotmail/Outlook), links padrão, agenda e receitas Make/n8n.
import { CalendarDays, Link2, Mail, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, SectionTitle, cn } from "@/components/ui/primitives";
import { useRepo, useSnapshot } from "@/lib/data/hooks";
import { toast } from "sonner";
import { useEmailApp, useSaveOrgSettings } from "@/lib/data/settings";
import { ACCOUNT_STATUS_LABEL } from "@/lib/domain/constants";
import type { OrgSettings } from "@/lib/domain/integrations";
import {
  DEFAULT_EMAIL_TEMPLATES, EMAIL_APPS, EMAIL_VARS, type EmailApp, type EmailTemplate, type LinkSettings, composeLink, fillVars,
} from "@/lib/domain/links";
import type { AccountStatus } from "@/lib/domain/types";
import { useVarCtx } from "./contact-tools";

const field = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none disabled:opacity-60";
const ADVANCE_OPTIONS: AccountStatus[] = ["primeiro_contato", "discovery", "agendado", "demo_realizada", "proposta_enviada", "negociacao"];
const isUrl = (v?: string) => !v || /^https:\/\/\S+\.\S+/.test(v.trim());

export function EmailCard({ settings, isAdmin }: { settings: OrgSettings; isAdmin: boolean }) {
  const save = useSaveOrgSettings();
  const { app, setApp } = useEmailApp();
  const ctx = useVarCtx();
  const { data } = useSnapshot();
  const [tpls, setTpls] = useState<EmailTemplate[]>(settings.email?.templates?.length ? settings.email.templates : DEFAULT_EMAIL_TEMPLATES);
  useEffect(() => setTpls(settings.email?.templates?.length ? settings.email.templates : DEFAULT_EMAIL_TEMPLATES), [settings.email]);
  const sample = data?.accounts.find((a) => a.decision_maker_name) ?? data?.accounts[0] ??
    { name: "Restaurante Exemplo", decision_maker_name: "Carlos", neighborhood: "Campo Grande", current_system: "Anota AI", email: "" };
  const set = (id: string, patch: Partial<EmailTemplate>) => setTpls(tpls.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  return (
    <Card className="space-y-3">
      <SectionTitle><span className="flex items-center gap-1.5"><Mail size={14} /> E-mail: Gmail, Hotmail e Outlook</span></SectionTitle>
      <p className="text-[11px] text-slate-400">
        Sem senha e sem custo: o botão 📧 abre o rascunho pronto no e-mail em que você já está logado. Se o modelo tiver etapa,
        a conta avança sozinha (nunca volta etapa).
      </p>
      <label className="block space-y-1 text-xs text-slate-300">
        App de e-mail <span className="text-slate-500">(deste aparelho)</span>
        <select className={field} value={app} onChange={(e) => setApp(e.target.value as EmailApp)}>
          {EMAIL_APPS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </label>
      <p className="text-[10px] text-slate-500">Variáveis: {EMAIL_VARS.join(" ")}</p>
      <ul className="space-y-2">
        {tpls.map((t) => (
          <li key={t.id} className="space-y-1.5 rounded-lg border border-slate-800 p-2.5">
            <div className="flex gap-2">
              <input aria-label="Nome do modelo" className={cn(field, "py-1.5 text-xs")} disabled={!isAdmin} value={t.name} onChange={(e) => set(t.id, { name: e.target.value })} />
              {isAdmin ? (
                <button type="button" aria-label="Remover modelo" className="p-1 text-slate-500 hover:text-red-300" onClick={() => setTpls(tpls.filter((x) => x.id !== t.id))}>
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
            <input aria-label="Assunto" className={cn(field, "py-1.5 text-xs")} disabled={!isAdmin} value={t.subject} onChange={(e) => set(t.id, { subject: e.target.value })} />
            <textarea aria-label="Texto" rows={4} className={cn(field, "text-xs")} disabled={!isAdmin} value={t.body} onChange={(e) => set(t.id, { body: e.target.value })} />
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              Ao enviar, mover para
              <select className="rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200" disabled={!isAdmin}
                value={t.advance_to ?? ""} onChange={(e) => set(t.id, { advance_to: (e.target.value || undefined) as AccountStatus | undefined })}>
                <option value="">não mexe na etapa</option>
                {ADVANCE_OPTIONS.map((s) => <option key={s} value={s}>{ACCOUNT_STATUS_LABEL[s]}</option>)}
              </select>
              <a className="ml-auto text-brand-300 hover:underline" target="_blank" rel="noopener noreferrer"
                href={composeLink(app, { to: "", subject: fillVars(t.subject, sample, ctx), body: fillVars(t.body, sample, ctx) })}>
                Testar no {EMAIL_APPS.find((a) => a.id === app)?.label.split(" ")[0]}
              </a>
            </div>
          </li>
        ))}
      </ul>
      {isAdmin ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setTpls([...tpls, { id: `e-${Date.now()}`, name: "Novo modelo", subject: "", body: "Olá {nome},\n\n\n{vendedor}" }])}>
            <Plus size={13} /> Modelo
          </Button>
          <Button onClick={() => setTpls(DEFAULT_EMAIL_TEMPLATES)}>Restaurar padrão</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate({ ...settings, email: { templates: tpls } })}>
            {save.isPending ? "Salvando…" : "Salvar modelos"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function LinksCard({ settings, isAdmin }: { settings: OrgSettings; isAdmin: boolean }) {
  const save = useSaveOrgSettings();
  const [l, setL] = useState<LinkSettings>(settings.links ?? {});
  useEffect(() => setL(settings.links ?? {}), [settings.links]);
  const fields: { k: keyof LinkSettings; label: string; ph: string; hint: string }[] = [
    { k: "scheduling", label: "Link de agendamento", ph: "https://calendly.com/seu-nome/demo", hint: "Calendly, Cal.com ou página de agendamento do Google Agenda (todos têm plano grátis). Vira {link_agenda}." },
    { k: "proposal", label: "Proposta padrão", ph: "https://drive.google.com/file/d/…", hint: "PDF ou Doc no Drive com acesso por link. Vira {link_proposta}." },
    { k: "drive_folder", label: "Pasta de clientes (Drive/OneDrive)", ph: "https://drive.google.com/drive/folders/…", hint: "O botão 📁 Drive da ficha abre aqui (sem link, pesquisa o nome no seu Drive)." },
  ];
  const ok = fields.every((f) => isUrl(l[f.k]));
  return (
    <Card className="space-y-3">
      <SectionTitle><span className="flex items-center gap-1.5"><Link2 size={14} /> Links padrão (agenda, proposta, Drive)</span></SectionTitle>
      {fields.map((f) => (
        <label key={f.k} className="block space-y-1 text-xs text-slate-300">
          {f.label}
          <input className={cn(field, l[f.k] && !isUrl(l[f.k]) && "border-red-500")} disabled={!isAdmin} placeholder={f.ph}
            value={l[f.k] ?? ""} onChange={(e) => setL({ ...l, [f.k]: e.target.value.trim() || undefined })} />
          <span className="block text-[10px] text-slate-500">{f.hint}</span>
        </label>
      ))}
      {!ok ? <p className="text-[11px] text-red-300">Use links que começam com https://</p> : null}
      {isAdmin ? (
        <Button variant="primary" disabled={save.isPending || !ok} onClick={() => save.mutate({ ...settings, links: l })}>
          {save.isPending ? "Salvando…" : "Salvar links"}
        </Button>
      ) : null}
    </Card>
  );
}

export function CalendarCard() {
  const repo = useRepo();
  const [feed, setFeed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    if (feed && !window.confirm("Gerar um link novo desliga o anterior (a agenda que já assinou para de atualizar). Continuar?")) return;
    setBusy(true);
    try {
      const token = await repo.rotateCalendarFeed();
      setFeed(`${window.location.origin}/api/agenda/${token}.ics`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar o link.");
    } finally {
      setBusy(false);
    }
  };
  const webcal = feed?.replace(/^https?:/, "webcal:");
  return (
    <Card className="space-y-2">
      <SectionTitle><span className="flex items-center gap-1.5"><CalendarDays size={14} /> Agenda: Google, Outlook e celular</span></SectionTitle>
      <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
        <div className="text-xs font-semibold text-emerald-300">🔄 Assinar minhas visitas (atualiza sozinho)</div>
        <p className="text-[11px] text-slate-400">
          Gera um link secreto só seu. A agenda do Google/Outlook/iPhone passa a mostrar suas visitas e atualiza sozinha
          (o Google leva de algumas horas até 1 dia para atualizar; Outlook e iPhone são mais rápidos). O link aparece uma vez: guarde ou assine na hora.
        </p>
        {feed ? (
          <>
            <input readOnly aria-label="Link da agenda" className={cn(field, "font-mono text-[11px]")} value={feed} onFocus={(e) => e.target.select()} />
            <div className="flex flex-wrap gap-1.5">
              <a className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-onaccent" target="_blank" rel="noopener noreferrer"
                href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal!)}`}>Assinar no Google Agenda</a>
              <a className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200" target="_blank" rel="noopener noreferrer"
                href={`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=${encodeURIComponent("FieldOS · Visitas")}`}>Outlook / Hotmail</a>
              <a className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200" href={webcal}>iPhone / Mac</a>
              <button type="button" className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-200"
                onClick={() => void navigator.clipboard?.writeText(feed).then(() => toast.success("Link copiado."))}>Copiar</button>
            </div>
          </>
        ) : null}
        <Button size="sm" variant={feed ? "outline" : "success"} disabled={busy} onClick={() => void gen()}>
          {busy ? "Gerando…" : feed ? "Gerar link novo" : "Gerar meu link de agenda"}
        </Button>
      </div>
      <ul className="list-disc space-y-1 pl-4 text-[11px] text-slate-300">
        <li><b>Na ficha:</b> a próxima visita (ou follow-up) tem botões Google Agenda, Outlook e .ics.</li>
        <li><b>No Hoje e nas Rotas:</b> “Agenda (.ics)” baixa todas as visitas do dia com lembrete 30 min antes. No celular, abrir o arquivo adiciona na agenda.</li>
        <li><b>Agendamento pelo cliente:</b> cadastre o link do Calendly/Cal.com/Google em Links padrão; ele entra nos e-mails.</li>
        <li><b>Google Meet:</b> o botão 🎥 da ficha cria uma sala na hora.</li>
      </ul>
    </Card>
  );
}

const RECIPES: { title: string; event: string; steps: string }[] = [
  { title: "Venda fechada → planilha de comissões (Google Sheets)", event: "deal.won", steps: "Make: Webhooks › Custom webhook → Google Sheets › Add a row (restaurante, MRR, data)." },
  { title: "Venda fechada → e-mail de boas-vindas automático (Gmail)", event: "deal.won", steps: "Make: Webhooks → Gmail › Send an email para account.email com o modelo de boas-vindas." },
  { title: "Visita realizada → evento no Google Agenda + nota", event: "visit.checkin", steps: "n8n: Webhook → Google Calendar › Create event (histórico do dia) e Google Drive › Create file (ata da visita)." },
  { title: "Proposta enviada → lembrete em 2 dias (Google Tasks / Agenda)", event: "proposal.sent", steps: "Make: Webhooks → Tools › Sleep/Set variable → Google Tasks › Create a task “Cobrar decisão”." },
  { title: "Venda fechada → aviso no grupo do time (Slack / Telegram)", event: "deal.won", steps: "n8n: Webhook → Telegram › Send message “🎉 {restaurante} fechou R$ {mrr}”." },
  { title: "Proposta enviada → pasta do cliente no Drive", event: "proposal.sent", steps: "Make: Webhooks → Google Drive › Create a folder com o nome do restaurante e copia a proposta modelo." },
];

export function RecipesCard() {
  return (
    <Card className="space-y-2 lg:col-span-2">
      <SectionTitle><span className="flex items-center gap-1.5"><Sparkles size={14} /> Receitas de automação grátis (Make / n8n)</span></SectionTitle>
      <p className="text-[11px] text-slate-400">
        Use os webhooks acima. Make tem plano grátis com 1.000 operações/mês; n8n é grátis se você hospedar. Nenhuma senha de Gmail ou Google fica no CRM:
        quem conecta sua conta Google é o Make/n8n.
      </p>
      <ul className="grid gap-2 md:grid-cols-2">
        {RECIPES.map((r) => (
          <li key={r.title} className="rounded-lg border border-slate-800 p-2.5">
            <div className="text-xs font-semibold text-slate-100">{r.title}</div>
            <div className="mt-0.5 text-[10px] text-indigo-300">evento: <code>{r.event}</code></div>
            <div className="mt-1 text-[11px] text-slate-400">{r.steps}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
