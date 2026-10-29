"use client";
// CHAVE: qualificação ICP, objeções por persona, auditoria estruturada, termômetro e playbooks.
import { BookOpen, Calculator, ClipboardCheck, Copy, Gauge, MessageSquareWarning, Plus, Search, ShieldCheck, Trash2, Zap } from "lucide-react";
import { PainCalculator } from "@/components/drawer/pain-calculator";
import { missingDefaults } from "@/lib/domain/playbooks";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, SectionTitle, cn, scoreColor } from "@/components/ui/primitives";
import { useActions, useEnriched, useRepo, useSnapshot } from "@/lib/data/hooks";
import { useUi } from "@/lib/ui-store";
import { AccountLink } from "@/components/ui/account-link";
import {
  AUDIT_ITEMS, CHAVE_STAGES, ICP_QUESTIONS, MIN_SAMPLE, OBJECTIONS, PERSONA_GUIDE, buildAuditPrompt, chaveMetrics, icpResult,
  isAudit, metricAlert, scoreAudit,
} from "@/lib/domain/chave";
import { ACCOUNT_STATUS_LABEL, PERSONA_LABEL, PRIORITY_LABEL, STAGE_LABEL } from "@/lib/domain/constants";
import { dateInTz, formatDateBR } from "@/lib/domain/dates";
import type { EnrichedAccount } from "@/lib/domain/enrich";
import type { IcpChecklist, IcpKey, Persona, Playbook } from "@/lib/domain/types";

type Tab = "icp" | "ancoragem" | "objecoes" | "auditar" | "termometro" | "playbooks";
const TABS: { id: Tab; label: string; icon: typeof Search }[] = [
  { id: "icp", label: "Qualificar (ICP)", icon: ShieldCheck },
  { id: "ancoragem", label: "Ancoragem de dor", icon: Calculator },
  { id: "objecoes", label: "Objeções", icon: MessageSquareWarning },
  { id: "auditar", label: "Auditar", icon: ClipboardCheck },
  { id: "termometro", label: "Termômetro", icon: Gauge },
  { id: "playbooks", label: "Playbooks", icon: BookOpen },
];
const field = "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none";

async function copy(text: string, msg = "Copiado.") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(msg);
  } catch {
    toast.error("Não consegui copiar. Selecione o texto e copie manualmente.");
  }
}

export function ChaveView() {
  const [tab, setTab] = useState<Tab>("icp");
  const [accId, setAccId] = useState<string | null>(null);
  const { data, isLoading } = useSnapshot();
  const enriched = useEnriched(data);

  useEffect(() => {
    // atalho vindo da ficha do cliente: /chave?conta=<id>&aba=auditar
    const q = new URLSearchParams(window.location.search);
    if (q.get("conta")) setAccId(q.get("conta"));
    const aba = q.get("aba") as Tab | null;
    if (aba && TABS.some((t) => t.id === aba)) setTab(aba);
  }, []);

  if (isLoading || !data) return <div className="py-20 text-center text-sm text-slate-500">Carregando CHAVE…</div>;
  const acc = accId ? enriched.get(accId) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-white">Método CHAVE</h1>
          <p className="text-xs text-slate-400">Conexão · Hipótese · Ancoragem · Virada · Extensão. Venda se perde por pular etapa.</p>
        </div>
        <div role="tablist" className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-900 p-1">
          {TABS.map((t) => (
            <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold", tab === t.id ? "bg-brand-600 text-onaccent" : "text-slate-400 hover:text-slate-200")}>
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "icp" || tab === "auditar" || tab === "ancoragem" ? <AccountPicker all={[...enriched.values()]} value={acc} onChange={setAccId} /> : null}
      {tab === "icp" ? <IcpTab acc={acc} all={[...enriched.values()]} onPick={setAccId} /> : null}
      {tab === "ancoragem" ? (
        <Card>
          <PainCalculator acc={acc} wide />
          {!acc ? <p className="mt-2 text-[11px] text-slate-500">Sem restaurante escolhido, a conta é só simulação. Escolha um acima para salvar o número no card.</p> : null}
        </Card>
      ) : null}
      {tab === "objecoes" ? <ObjectionsTab persona={acc?.persona} /> : null}
      {tab === "auditar" ? <AuditTab acc={acc} /> : null}
      {tab === "termometro" ? <ThermoTab /> : null}
      {tab === "playbooks" ? <PlaybooksTab /> : null}
    </div>
  );
}

function AccountPicker({ all, value, onChange }: { all: EnrichedAccount[]; value?: EnrichedAccount; onChange: (id: string | null) => void }) {
  const openDrawer = useUi((s) => s.openDrawer);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const term = q.trim().toLowerCase();
  const hits = term ? all.filter((a) => a.name.toLowerCase().includes(term) || a.neighborhood?.toLowerCase().includes(term)).slice(0, 8) : [];
  if (value && !open)
    return (
      <Card className="flex items-center justify-between gap-2 p-3">
        <div className="min-w-0">
          <AccountLink id={value.id} name={value.name} className="text-sm font-bold text-white" />
          <div className="text-[11px] text-slate-400">{ACCOUNT_STATUS_LABEL[value.status]} · {value.neighborhood ?? "sem bairro"} · {PERSONA_LABEL[value.persona]}</div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="outline" onClick={() => openDrawer(value.id)}>Ficha</Button>
          <Button size="sm" onClick={() => { setOpen(true); setQ(""); }}>Trocar</Button>
        </div>
      </Card>
    );
  return (
    <div className="relative">
      <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2">
        <Search size={14} className="text-slate-500" />
        <input aria-label="Escolher restaurante" autoFocus={open} className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
          placeholder="Escolha o restaurante (nome ou bairro)…" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {hits.length ? (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {hits.map((a) => (
            <li key={a.id}>
              <button type="button" className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-800"
                onClick={() => { onChange(a.id); setOpen(false); setQ(""); }}>
                <span className="truncate text-slate-100">{a.name}</span>
                <span className="shrink-0 text-[11px] text-slate-500">{a.neighborhood}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
function IcpTab({ acc, all, onPick }: { acc?: EnrichedAccount; all: EnrichedAccount[]; onPick: (id: string) => void }) {
  const actions = useActions();
  const toQualify = useMemo(
    () => all.filter((a) => a.status !== "fechado" && a.status !== "perdido" && icpResult(a.icp_checklist).answered === 0)
      .sort((a, b) => b.commercial_score - a.commercial_score).slice(0, 6),
    [all],
  );
  if (!acc)
    return (
      <Card>
        <SectionTitle>Próximos a qualificar (maior score, ICP em branco)</SectionTitle>
        <ul className="space-y-1.5">
          {toQualify.map((a) => (
            <li key={a.id}>
              <div className="flex w-full items-center gap-2 rounded-lg bg-slate-950 px-3 py-2">
                <span className={cn("rounded px-1 font-mono text-[10px] font-bold", scoreColor(a.commercial_score))}>{a.commercial_score}</span>
                <span className="min-w-0 flex-1"><AccountLink id={a.id} name={a.name} className="text-sm text-slate-100" /></span>
                <span className="hidden text-[11px] text-slate-500 sm:inline">{a.neighborhood}</span>
                <Button size="sm" variant="primary" onClick={() => onPick(a.id)}>Qualificar</Button>
              </div>
            </li>
          ))}
          {!toQualify.length ? <p className="text-xs text-slate-500">Todas as contas ativas já têm ICP respondido.</p> : null}
        </ul>
      </Card>
    );

  const c: IcpChecklist = acc.icp_checklist ?? {};
  const r = icpResult(c);
  const set = (k: IcpKey, v: boolean | undefined) => {
    const next = { ...c };
    if (v === undefined) delete next[k];
    else next[k] = v;
    void actions.updateAccount(acc.id, { icp_checklist: next });
  };
  const guide = PERSONA_GUIDE[acc.persona];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <SectionTitle>Qualificação rápida (ICP)</SectionTitle>
        <ul className="space-y-2">
          {ICP_QUESTIONS.map((q) => (
            <li key={q.key} className="rounded-xl bg-slate-950 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-100">{q.label}</span>
                <span className="flex gap-1">
                  {([["Sim", true], ["Não", false]] as const).map(([l, v]) => (
                    <button key={l} type="button" aria-pressed={c[q.key] === v} onClick={() => set(q.key, c[q.key] === v ? undefined : v)}
                      className={cn("rounded-md px-2.5 py-1 text-xs font-semibold",
                        c[q.key] === v ? (v ? "bg-emerald-600 text-onaccent" : "bg-red-600 text-onaccent") : "bg-slate-800 text-slate-300")}>
                      {l}
                    </button>
                  ))}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">{q.hint}</p>
            </li>
          ))}
        </ul>
        <div className={cn("mt-3 rounded-xl border p-3 text-sm",
          r.verdict === "pipeline" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
          : r.verdict === "nutricao" ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-slate-700 text-slate-300")}>
          {r.verdict === "pipeline" ? "✅ Lead de pipeline ativo: vale o tempo de campo."
            : r.verdict === "nutricao" ? "🌱 Lead de nutrição (3+ respostas negativas): cadência leve, sem gastar visita agora."
            : `Responda as ${ICP_QUESTIONS.length - r.answered} pergunta(s) restante(s).`}
          {r.priority ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              Prioridade sugerida: <b>{PRIORITY_LABEL[r.priority]}</b>
              {r.priority !== acc.priority ? (
                <Button size="sm" onClick={() => void actions.updateAccount(acc.id, { priority: r.priority! }, "Prioridade atualizada.")}>Aplicar</Button>
              ) : <span className="text-slate-400">(já aplicada)</span>}
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <SectionTitle>Persona do decisor</SectionTitle>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {(Object.keys(PERSONA_LABEL) as Persona[]).map((p) => (
            <button key={p} type="button" aria-pressed={acc.persona === p}
              onClick={() => acc.persona !== p && void actions.updateAccount(acc.id, { persona: p }, "Persona atualizada.")}
              className={cn("rounded-full border px-2.5 py-1 text-xs", acc.persona === p ? "border-brand-500 bg-brand-600/20 text-brand-200" : "border-slate-700 text-slate-300")}>
              {PERSONA_LABEL[p]}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-300"><b>O que decide:</b> {guide.decide}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <div><div className="font-semibold text-emerald-300">Bom fit</div><ul className="list-disc pl-4 text-slate-400">{guide.goodFit.map((x) => <li key={x}>{x}</li>)}</ul></div>
          <div><div className="font-semibold text-red-300">Mau fit</div><ul className="list-disc pl-4 text-slate-400">{guide.badFit.map((x) => <li key={x}>{x}</li>)}</ul></div>
        </div>
        <div className="mt-3 space-y-1.5 text-xs">
          <ScriptLine label="Hipótese" text={guide.hipotese} />
          <ScriptLine label="Ancoragem" text={guide.ancoragem} />
        </div>
      </Card>
    </div>
  );
}

function ScriptLine({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-slate-950 p-2">
      <Badge className="shrink-0">{label}</Badge>
      <span className="flex-1 text-slate-200">“{text}”</span>
      <button type="button" aria-label={`Copiar ${label}`} className="text-slate-500 hover:text-slate-200" onClick={() => void copy(text)}><Copy size={13} /></button>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ObjectionsTab({ persona: initial }: { persona?: Persona }) {
  const [persona, setPersona] = useState<Persona | "todas">(initial ?? "todas");
  const list = OBJECTIONS.filter((o) => persona === "todas" || o.personas.includes(persona));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["todas", ...Object.keys(PERSONA_LABEL)] as (Persona | "todas")[]).map((p) => (
          <button key={p} type="button" aria-pressed={persona === p} onClick={() => setPersona(p)}
            className={cn("rounded-full border px-2.5 py-1 text-xs", persona === p ? "border-brand-500 bg-brand-600/20 text-brand-200" : "border-slate-700 text-slate-300")}>
            {p === "todas" ? "Todas" : PERSONA_LABEL[p]}
          </button>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {list.map((o) => (
          <Card key={o.id} className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-white">“{o.objection}”</h3>
              <Badge>{CHAVE_STAGES.find((s) => s.key === o.stage)?.name}</Badge>
            </div>
            <p className="text-[11px] text-slate-400"><b className="text-slate-300">De verdade:</b> {o.really}</p>
            <p className="text-[11px] text-slate-400"><b className="text-slate-300">Caminho:</b> {o.answer}</p>
            <div className="flex items-start gap-2 rounded-lg bg-slate-950 p-2 text-xs text-slate-200">
              <span className="flex-1">“{o.isolate}”</span>
              <button type="button" aria-label="Copiar resposta" className="text-slate-500 hover:text-slate-200" onClick={() => void copy(o.isolate, "Resposta copiada.")}><Copy size={13} /></button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function AuditTab({ acc }: { acc?: EnrichedAccount }) {
  const { data } = useSnapshot();
  const actions = useActions();
  const opps = (data?.opportunities ?? []).filter((o) => o.account_id === acc?.id).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const [oppId, setOppId] = useState<string | null>(null);
  const opp = opps.find((o) => o.id === oppId) ?? opps[0] ?? null;
  const saved = opp && isAudit(opp.chave_checklist) ? opp.chave_checklist : null;
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  useEffect(() => setAnswers(saved?.answers ?? {}), [saved, opp?.id]);
  useEffect(() => setNotes(""), [acc?.id]);

  if (!acc) return <Card className="text-sm text-slate-400">Escolha o restaurante para auditar a última conversa ou visita.</Card>;
  const r = scoreAudit(answers, acc.persona);
  const visits = (data?.visits ?? []).filter((v) => v.account_id === acc.id).sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
  const prompt = buildAuditPrompt(acc, opp, visits, notes);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <SectionTitle right={opps.length > 1 ? (
          <select aria-label="Oportunidade" className="rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-200" value={opp?.id} onChange={(e) => setOppId(e.target.value)}>
            {opps.map((o) => <option key={o.id} value={o.id}>{o.title} · {STAGE_LABEL[o.stage]}</option>)}
          </select>
        ) : null}>
          Checklist de aplicação
        </SectionTitle>
        <ul className="space-y-1.5">
          {AUDIT_ITEMS.map((i) => (
            <li key={i.id}>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-slate-950 p-2 text-xs text-slate-200">
                <input type="checkbox" className="mt-0.5" checked={!!answers[i.id]} onChange={(e) => setAnswers((a) => ({ ...a, [i.id]: e.target.checked }))} />
                <span className="flex-1">{i.label}</span>
                <Badge className="shrink-0">{CHAVE_STAGES.find((s) => s.key === i.stage)?.letter}</Badge>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-3 grid grid-cols-5 gap-1 text-center">
          {CHAVE_STAGES.map((s) => (
            <div key={s.key} className="rounded-lg bg-slate-950 p-1.5">
              <div className="text-[10px] text-slate-500">{s.name}</div>
              <div className={cn("font-mono text-base font-extrabold", r.scores[s.key] >= 7 ? "text-emerald-300" : r.scores[s.key] >= 5 ? "text-amber-300" : "text-red-300")}>{r.scores[s.key]}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded-xl border border-brand-500/30 bg-brand-500/10 p-2.5 text-xs text-brand-100">
          <b>Nota geral {r.total.toFixed(1)}</b>
          {r.biggestFix ? <> · Mudança de maior impacto: {r.biggestFix}</> : " · Etapas completas. Agora é pedir indicação e acompanhar o resultado em 7 dias."}
        </div>
        {opp ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">{saved ? `Última auditoria: ${formatDateBR(dateInTz(saved.audited_at))} (nota ${saved.total})` : "Ainda não auditada"}</span>
            <Button size="sm" variant="primary" onClick={() => {
              const { biggestFix: _b, ...audit } = scoreAudit(answers, acc.persona);
              void _b;
              void actions.updateOpportunity(opp.id, { chave_checklist: audit }, "Auditoria salva na oportunidade.");
            }}>
              Salvar auditoria
            </Button>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-amber-300">Sem oportunidade nesta conta: a nota aparece, mas só fica salva quando houver uma (crie pela ficha ou pelo CRM).</p>
        )}
      </Card>

      <Card>
        <SectionTitle>Auditoria com IA (opcional)</SectionTitle>
        <p className="mb-2 text-[11px] text-slate-400">
          Cole a conversa do WhatsApp ou o resumo da visita. O prompt do método já vai com o contexto do CRM; cole no Claude ou ChatGPT do seu celular.
        </p>
        <textarea aria-label="Conversa ou resumo da visita" className={cn(field, "min-h-36 text-xs")} placeholder="Cole aqui a conversa ou escreva o resumo da visita…"
          value={notes} onChange={(e) => setNotes(e.target.value)} />
        <Button className="mt-2" variant="primary" onClick={() => void copy(prompt, "Prompt copiado. Cole no Claude.")}><Copy size={14} /> Copiar prompt de auditoria</Button>
        <details className="mt-2 text-[11px] text-slate-500">
          <summary className="cursor-pointer">Ver prompt</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-2">{prompt}</pre>
        </details>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function ThermoTab() {
  const { data } = useSnapshot();
  const { session } = useRepo();
  if (!data) return null;
  const today = dateInTz(new Date(), session.timezone);
  const ms = chaveMetrics(data, today);
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        Métricas de alerta do método, calculadas dos seus registros. Com menos de {MIN_SAMPLE} casos a métrica aparece sem alerta (amostra pequena engana).
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {ms.map((m) => {
          const alert = metricAlert(m);
          return (
            <Card key={m.id} className={cn("p-3", alert && "border-amber-500/50")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-300">{m.label}</span>
                <Badge>{CHAVE_STAGES.find((s) => s.key === m.stage)?.name}</Badge>
              </div>
              <div className={cn("mt-1 font-mono text-2xl font-extrabold", alert ? "text-amber-300" : "text-white")}>
                {m.value == null ? "—" : `${Math.round(m.value * 100)}%`}
              </div>
              <div className="text-[10px] text-slate-500">
                {m.base} caso(s) · referência {m.direction === "min" ? "acima de" : "abaixo de"} {Math.round(m.threshold * 100)}%
              </div>
              <p className={cn("mt-1.5 text-[11px]", alert ? "text-amber-200" : "text-slate-400")}>{m.how}</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
const PB_CATEGORIES = ["Objeções", "Scripts de Venda", "Produto", "Setor Restaurantes", "Dicas de Vendas", "Processos Internos", "Pós-venda", "Recuperação"];

function PlaybooksTab() {
  const { data } = useSnapshot();
  const actions = useActions();
  const [edit, setEdit] = useState<Playbook | null>(null);
  const list = [...(data?.playbooks ?? [])].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  const missing = missingDefaults(data?.playbooks ?? []);
  const [loading, setLoading] = useState(false);
  const blank = (): Playbook => ({ id: crypto.randomUUID(), org_id: "", title: "", category: PB_CATEGORIES[0], funnel_stage: null, channel: null, content_md: "", ai_enabled: true, updated_at: "" });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">Scripts e respostas do time. A base do método (objeções, personas, ICP) já está nas outras abas.</p>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {missing.length ? (
            <Button size="sm" disabled={loading} onClick={async () => {
              setLoading(true);
              await actions.savePlaybooks(
                missing.map((p) => ({ id: crypto.randomUUID(), title: p.title, category: p.category, funnel_stage: p.funnel_stage, channel: p.channel, content_md: p.content_md, ai_enabled: true })),
                `${missing.length} playbook(s) padrão Takeat carregados.`,
              );
              setLoading(false);
            }}>
              <Zap size={13} /> {loading ? "Carregando…" : `Carregar Playbooks Padrão Takeat (${missing.length})`}
            </Button>
          ) : null}
          <Button size="sm" variant="primary" onClick={() => setEdit(blank())}><Plus size={13} /> Novo</Button>
        </div>
      </div>
      {edit ? (
        <Card className="space-y-2">
          <input aria-label="Título" className={field} placeholder="Título (ex.: Resposta para 'já uso Saipos')" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <select aria-label="Categoria" className={field} value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
            {PB_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <textarea aria-label="Conteúdo" className={cn(field, "min-h-40")} placeholder="Texto do script…" value={edit.content_md} onChange={(e) => setEdit({ ...edit, content_md: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button size="sm" variant="primary" onClick={async () => {
              const { id, title, category, funnel_stage, channel, content_md, ai_enabled } = edit;
              if (await actions.savePlaybook({ id, title, category, funnel_stage, channel, content_md, ai_enabled })) setEdit(null);
            }}>Salvar</Button>
          </div>
        </Card>
      ) : null}
      <div className="grid gap-2 md:grid-cols-2">
        {list.map((p) => (
          <Card key={p.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Badge>{p.category}</Badge>
                <h3 className="mt-1 text-sm font-bold text-white">{p.title}</h3>
              </div>
              <span className="flex gap-1">
                <button type="button" aria-label="Copiar" className="p-1 text-slate-500 hover:text-slate-200" onClick={() => void copy(p.content_md)}><Copy size={13} /></button>
                <button type="button" aria-label="Editar" className="p-1 text-xs text-slate-500 hover:text-slate-200" onClick={() => setEdit(p)}>Editar</button>
                <button type="button" aria-label="Excluir" className="p-1 text-slate-500 hover:text-red-300"
                  onClick={() => window.confirm(`Excluir "${p.title}"?`) && void actions.deletePlaybook(p.id)}><Trash2 size={13} /></button>
              </span>
            </div>
            <p className="mt-1 line-clamp-4 whitespace-pre-line text-xs text-slate-400">{p.content_md}</p>
          </Card>
        ))}
        {!list.length && !edit ? <Card className="text-xs text-slate-500">Nenhum playbook ainda. Registre o script que mais funcionou esta semana.</Card> : null}
      </div>
    </div>
  );
}
