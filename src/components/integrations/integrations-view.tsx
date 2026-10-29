"use client";
// Integrações & automações: WhatsApp (link ou API), webhooks de saída, app de navegação e CSV/JSON.
import { Download, FileUp, Link2, MessageCircle, Navigation, Plus, Send, Trash2, Upload, Webhook } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, SectionTitle, cn } from "@/components/ui/primitives";
import { useActions, useRepo, useSnapshot } from "@/lib/data/hooks";
import { pickUpdatable } from "@/lib/data/repo";
import { useNavApp, useOrgSettings, useSaveOrgSettings } from "@/lib/data/settings";
import {
  DEFAULT_TEMPLATES, type ImportPlan, type OrgSettings, TEMPLATE_VARS, WEBHOOK_EVENTS, type WaMode, type WaTemplate, type WebhookEvent,
  fillTemplate, isSafeWebhookUrl, parseCsv, planImport, toCsv, waDigits,
} from "@/lib/domain/integrations";
import type { Account } from "@/lib/domain/types";
import { sendViaApi } from "./wa-templates";
import { CalendarCard, EmailCard, LinksCard, RecipesCard } from "./integrations-more";

const field = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none disabled:opacity-60";

export function IntegrationsView() {
  const { session } = useRepo();
  const { data: settings, isLoading } = useOrgSettings();
  const isAdmin = session.mode === "demo" || session.role === "admin";
  if (isLoading || !settings) return <div className="py-20 text-center text-sm text-slate-500">Carregando integrações…</div>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-white">Integrações & automações</h1>
        <p className="text-xs text-slate-400">
          WhatsApp, e-mail (Gmail, Hotmail, Outlook), agenda, links padrão, webhooks para Make/n8n/Zapier, navegação e planilhas. Tudo grátis.
          {!isAdmin ? " Só o administrador altera WhatsApp e webhooks; você pode usar navegação e CSV." : ""}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <WhatsAppCard settings={settings} isAdmin={isAdmin} />
        <EmailCard settings={settings} isAdmin={isAdmin} />
        <LinksCard settings={settings} isAdmin={isAdmin} />
        <CalendarCard />
        <WebhookCard settings={settings} isAdmin={isAdmin} />
        <NavigationCard />
        <RecipesCard />
        <CsvCard />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// a) WhatsApp
// ---------------------------------------------------------------------------
function WhatsAppCard({ settings, isAdmin }: { settings: OrgSettings; isAdmin: boolean }) {
  const save = useSaveOrgSettings();
  const { data } = useSnapshot();
  const init = settings.whatsapp ?? { mode: "link" as WaMode, templates: DEFAULT_TEMPLATES };
  const [cfg, setCfg] = useState(init);
  const [testPhone, setTestPhone] = useState("");
  useEffect(() => setCfg(settings.whatsapp ?? { mode: "link", templates: DEFAULT_TEMPLATES }), [settings.whatsapp]);
  const templates = cfg.templates?.length ? cfg.templates : DEFAULT_TEMPLATES;
  const sample: Pick<Account, "name" | "decision_maker_name" | "neighborhood" | "current_system"> =
    data?.accounts.find((a) => a.decision_maker_name && a.current_system) ?? data?.accounts[0] ??
    { name: "Restaurante Exemplo", decision_maker_name: "Carlos", neighborhood: "Campo Grande", current_system: "Anota AI" };
  const setTpl = (id: string, patch: Partial<WaTemplate>) => setCfg({ ...cfg, templates: templates.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  return (
    <Card className="space-y-3">
      <SectionTitle right={<Badge>{cfg.mode === "link" ? "wa.me" : cfg.mode === "evolution" ? "Evolution API" : "Z-API"}</Badge>}>
        <span className="flex items-center gap-1.5"><MessageCircle size={14} /> WhatsApp</span>
      </SectionTitle>
      <div role="radiogroup" aria-label="Modo do WhatsApp" className="grid grid-cols-3 gap-1 rounded-lg border border-slate-800 p-1 text-xs">
        {(["link", "evolution", "zapi"] as WaMode[]).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={cfg.mode === m} disabled={!isAdmin} onClick={() => setCfg({ ...cfg, mode: m })}
            className={cn("rounded-md px-2 py-1.5 font-semibold", cfg.mode === m ? "bg-brand-600 text-onaccent" : "text-slate-400")}>
            {m === "link" ? "Link direto" : m === "evolution" ? "Evolution API" : "Z-API"}
          </button>
        ))}
      </div>
      {cfg.mode === "link" ? (
        <p className="text-[11px] text-slate-400">Abre o WhatsApp do seu celular com a mensagem pronta (wa.me). Grátis, sem risco de bloqueio do número. Recomendado.</p>
      ) : (
        <div className="space-y-2">
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
            APIs não oficiais podem levar o WhatsApp a bloquear o número em envio em volume. O token fica nas configurações da empresa e
            qualquer usuário logado dela consegue lê-lo. Use um número dedicado.
          </p>
          {cfg.mode === "evolution" ? (
            <input aria-label="URL do servidor Evolution" className={field} disabled={!isAdmin} placeholder="https://evolution.seudominio.com"
              value={cfg.base_url ?? ""} onChange={(e) => setCfg({ ...cfg, base_url: e.target.value })} />
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Instância" className={field} disabled={!isAdmin} placeholder={cfg.mode === "zapi" ? "ID da instância" : "Nome da instância"}
              value={cfg.instance ?? ""} onChange={(e) => setCfg({ ...cfg, instance: e.target.value })} />
            <input aria-label="Token" type="password" autoComplete="off" className={field} disabled={!isAdmin} placeholder={cfg.mode === "zapi" ? "Token da instância" : "API key"}
              value={cfg.token ?? ""} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} />
          </div>
          {cfg.mode === "zapi" ? (
            <input aria-label="Client-Token" type="password" autoComplete="off" className={field} disabled={!isAdmin} placeholder="Client-Token da conta (segurança Z-API)"
              value={cfg.client_token ?? ""} onChange={(e) => setCfg({ ...cfg, client_token: e.target.value })} />
          ) : null}
          <div className="flex gap-2">
            <input aria-label="Número para teste" className={field} placeholder="Seu número para teste (21) 9…" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
            <Button size="sm" disabled={!waDigits(testPhone)} onClick={() => void sendViaApi(cfg, waDigits(testPhone)!, "Teste do FieldOS CRM ✅")}>
              <Send size={13} /> Testar
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-slate-800 pt-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-slate-300">Modelos de mensagem</div>
          {isAdmin ? (
            <Button size="sm" onClick={() => setCfg({ ...cfg, templates: [...templates, { id: crypto.randomUUID(), name: "Novo modelo", text: "Olá {nome}, " }] })}>
              <Plus size={13} /> Modelo
            </Button>
          ) : null}
        </div>
        <p className="text-[10px] text-slate-500">Variáveis: {TEMPLATE_VARS.join(" ")}. Prévia com {sample.name}.</p>
        {templates.map((t) => (
          <div key={t.id} className="space-y-1 rounded-lg border border-slate-800 p-2">
            <div className="flex gap-2">
              <input aria-label="Nome do modelo" className={cn(field, "py-1 text-xs")} disabled={!isAdmin} value={t.name} onChange={(e) => setTpl(t.id, { name: e.target.value })} />
              {isAdmin ? (
                <button type="button" aria-label={`Excluir modelo ${t.name}`} className="px-1 text-slate-500 hover:text-red-300"
                  onClick={() => setCfg({ ...cfg, templates: templates.filter((x) => x.id !== t.id) })}><Trash2 size={13} /></button>
              ) : null}
            </div>
            <textarea aria-label={`Texto do modelo ${t.name}`} className={cn(field, "min-h-16 text-xs")} disabled={!isAdmin} value={t.text} onChange={(e) => setTpl(t.id, { text: e.target.value })} />
            {isAdmin ? (
              <div className="flex flex-wrap gap-1">
                {TEMPLATE_VARS.map((v) => (
                  <button key={v} type="button" className="rounded bg-slate-800 px-1.5 text-[10px] text-slate-300 hover:bg-slate-700" onClick={() => setTpl(t.id, { text: `${t.text}${v}` })}>{v}</button>
                ))}
              </div>
            ) : null}
            <p className="text-[11px] italic text-slate-400">“{fillTemplate(t.text, sample)}”</p>
          </div>
        ))}
      </div>
      {isAdmin ? (
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate({ ...settings, whatsapp: { ...cfg, templates } })}>
          {save.isPending ? "Salvando…" : "Salvar WhatsApp"}
        </Button>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// b) Webhooks
// ---------------------------------------------------------------------------
function WebhookCard({ settings, isAdmin }: { settings: OrgSettings; isAdmin: boolean }) {
  const save = useSaveOrgSettings();
  const [cfg, setCfg] = useState(settings.webhook ?? { enabled: false, url: "", events: WEBHOOK_EVENTS.map((e) => e.id) as WebhookEvent[] });
  useEffect(() => {
    if (settings.webhook) setCfg(settings.webhook);
  }, [settings.webhook]);
  const urlOk = isSafeWebhookUrl(cfg.url);
  const toggle = (id: WebhookEvent) =>
    setCfg({ ...cfg, events: cfg.events.includes(id) ? cfg.events.filter((x) => x !== id) : [...cfg.events, id] });

  const test = async () => {
    try {
      // no-cors: Make/n8n/Zapier recebem o POST mesmo sem liberar CORS (o navegador só não mostra a resposta)
      await fetch(cfg.url, {
        method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ event: "test", occurred_at: new Date().toISOString(), source: "FieldOS CRM", account: { name: "Restaurante Exemplo", neighborhood: "Campo Grande" } }),
      });
      toast.success("Teste enviado. Confira se chegou no Make/n8n/Zapier.");
    } catch {
      toast.error("Não consegui enviar o teste (rede ou URL).");
    }
  };

  return (
    <Card className="space-y-3">
      <SectionTitle right={<Badge className={cfg.enabled && urlOk ? "bg-emerald-500/15 text-emerald-300" : ""}>{cfg.enabled && urlOk ? "Ligado" : "Desligado"}</Badge>}>
        <span className="flex items-center gap-1.5"><Webhook size={14} /> Webhooks de saída</span>
      </SectionTitle>
      <p className="text-[11px] text-slate-400">
        O banco envia um POST em JSON (evento, conta, visita ou oportunidade) quando o evento acontece, de qualquer aparelho.
        Serve para Make, n8n ou Zapier (planilha, e-mail, Slack, onboarding).
      </p>
      <input aria-label="URL do webhook" className={cn(field, cfg.url && !urlOk && "border-red-500")} disabled={!isAdmin}
        placeholder="https://hook.us1.make.com/…" value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value.trim() })} />
      {cfg.url && !urlOk ? <p className="text-[11px] text-red-300">Use uma URL https pública.</p> : null}
      <div className="space-y-1">
        {WEBHOOK_EVENTS.map((e) => (
          <label key={e.id} className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" disabled={!isAdmin} checked={cfg.events.includes(e.id)} onChange={() => toggle(e.id)} />
            <code className="text-[11px] text-indigo-300">{e.id}</code> {e.label}
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input type="checkbox" disabled={!isAdmin} checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Ativar disparo automático
      </label>
      <div className="flex flex-wrap gap-2">
        {isAdmin ? (
          <Button variant="primary" disabled={save.isPending || (cfg.enabled && !urlOk)} onClick={() => save.mutate({ ...settings, webhook: cfg })}>
            {save.isPending ? "Salvando…" : "Salvar webhook"}
          </Button>
        ) : null}
        <Button disabled={!urlOk} onClick={() => void test()}><Link2 size={13} /> Enviar teste</Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// c) Navegação
// ---------------------------------------------------------------------------
function NavigationCard() {
  const { app, setApp } = useNavApp();
  return (
    <Card className="space-y-3">
      <SectionTitle><span className="flex items-center gap-1.5"><Navigation size={14} /> Google Maps ou Waze</span></SectionTitle>
      <p className="text-[11px] text-slate-400">App aberto ao tocar em “Ir”, “Abrir rota” e “Mapa”. Fica salvo neste aparelho.</p>
      <div role="radiogroup" aria-label="App de navegação" className="grid grid-cols-2 gap-2">
        {(["google", "waze"] as const).map((a) => (
          <button key={a} type="button" role="radio" aria-checked={app === a} onClick={() => { setApp(a); toast.success(`Navegação: ${a === "google" ? "Google Maps" : "Waze"}.`); }}
            className={cn("rounded-lg border px-3 py-2 text-sm font-semibold", app === a ? "border-brand-500 bg-brand-600/20 text-white" : "border-slate-700 text-slate-400")}>
            {a === "google" ? "Google Maps" : "Waze"}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-500">O Waze não aceita várias paradas: a rota completa do dia continua abrindo no Google Maps; o Waze abre parada por parada.</p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// d) CSV / JSON
// ---------------------------------------------------------------------------
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CsvCard() {
  const { data } = useSnapshot();
  const actions = useActions();
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const accounts = data?.accounts ?? [];
  const stamp = new Date().toISOString().slice(0, 10);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    const rows = parseCsv(text);
    setPlan(planImport(rows, accounts));
    if (fileRef.current) fileRef.current.value = "";
  };

  const apply = async () => {
    if (!plan) return;
    let ok = 0;
    let fail = 0;
    const total = plan.updates.length + plan.creates.length;
    let i = 0;
    for (const u of plan.updates) {
      setRunning(`${++i}/${total}`);
      if (await actions.updateAccount(u.id, pickUpdatable(u.patch))) ok++;
      else fail++;
    }
    for (const c of plan.creates) {
      setRunning(`${++i}/${total}`);
      const d = c.data;
      const id = await actions.createLead({
        name: d.name, whatsapp: d.whatsapp ?? d.phone ?? undefined, neighborhood: d.neighborhood ?? undefined,
        currentSystem: d.current_system ?? undefined, segment: d.segment ?? undefined, region: d.region ?? undefined,
      }, { silent: true });
      if (!id) { fail++; continue; }
      const rest = pickUpdatable(d);
      for (const k of ["name", "whatsapp", "neighborhood", "current_system", "segment", "region"] as const) delete rest[k];
      if (Object.keys(rest).length && !(await actions.updateAccount(id, rest))) fail++;
      else ok++;
    }
    setRunning(null);
    setPlan(null);
    if (fail) toast.warning(`${ok} linha(s) aplicadas, ${fail} com erro.`);
    else toast.success(`${ok} linha(s) aplicadas.`);
  };

  return (
    <Card className="space-y-3">
      <SectionTitle><span className="flex items-center gap-1.5"><FileUp size={14} /> Importar e exportar (CSV / JSON)</span></SectionTitle>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => download(`fieldos-contas-${stamp}.csv`, toCsv(accounts), "text/csv;charset=utf-8")}><Download size={13} /> Exportar CSV ({accounts.length})</Button>
        <Button onClick={() => download(`fieldos-contas-${stamp}.json`, JSON.stringify(accounts, null, 2), "application/json")}><Download size={13} /> Exportar JSON</Button>
        <Button variant="primary" onClick={() => fileRef.current?.click()}><Upload size={13} /> Importar CSV</Button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Arquivo CSV" onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      <p className="text-[11px] text-slate-400">
        Dica: exporte, edite no Excel/Sheets e importe de volta. A linha casa pela coluna <code>id</code> ou, sem id, por nome + bairro.
        Célula vazia não apaga nada. Status muda pelo pipeline, não pela planilha. Leads novos entram com o follow-up Dia 0.
      </p>
      {plan ? (
        <div className="space-y-2 rounded-lg border border-brand-500/30 bg-brand-500/5 p-3 text-xs text-slate-200">
          <div className="font-semibold">Prévia (nada foi gravado ainda)</div>
          <ul className="space-y-0.5">
            <li>✏️ {plan.updates.length} conta(s) para atualizar</li>
            <li>➕ {plan.creates.length} lead(s) novo(s)</li>
            <li>＝ {plan.unchanged} sem mudança</li>
            {plan.skipped.length ? <li className="text-amber-300">⚠️ {plan.skipped.length} aviso(s)</li> : null}
          </ul>
          {plan.updates.length ? (
            <details><summary className="cursor-pointer text-[11px] text-slate-400">Ver alterações</summary>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-[11px] text-slate-400">
                {plan.updates.slice(0, 100).map((u) => <li key={u.id}><b className="text-slate-200">{u.name}</b>: {Object.entries(u.patch).map(([k, v]) => `${k} → ${String(v)}`).join(", ")}</li>)}
              </ul>
            </details>
          ) : null}
          {plan.skipped.length ? (
            <ul className="max-h-28 space-y-0.5 overflow-auto text-[11px] text-amber-200">
              {plan.skipped.slice(0, 50).map((s, i) => <li key={i}>Linha {s.row}: {s.reason}</li>)}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Button variant="primary" disabled={!!running || !(plan.updates.length + plan.creates.length)} onClick={() => void apply()}>
              {running ? `Aplicando ${running}…` : "Aplicar"}
            </Button>
            <Button variant="outline" disabled={!!running} onClick={() => setPlan(null)}>Cancelar</Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
