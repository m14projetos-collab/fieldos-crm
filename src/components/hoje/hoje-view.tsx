"use client";
import { AlertTriangle, CalendarCheck, Clock, MapPin, MessageCircle, Navigation } from "lucide-react";
import { useMemo } from "react";
import { FollowUpRow } from "./follow-up-row";
import { QuickMrr, needsMrr } from "@/components/crm/quick-mrr";
import { LeadControls, MrrChips, SystemSelect, TempPill } from "@/components/crm/lead-controls";
import Link from "next/link";
import { Badge, Button, Card, SectionTitle, cn, scoreColor } from "@/components/ui/primitives";
import { preVisitScript, waLink, waNumber } from "@/lib/domain/cadence";
import { ACCOUNT_STATUS_LABEL, OUTCOME_LABEL, PERSONA_LABEL, VISIT_TYPE_LABEL } from "@/lib/domain/constants";
import { brl, timeInTz } from "@/lib/domain/dates";
import { computeToday } from "@/lib/domain/today";
import { useEnriched, useRepo, useScriptCtx, useSnapshot } from "@/lib/data/hooks";
import { useUi } from "@/lib/ui-store";
import { useNavApp } from "@/lib/data/settings";
import { navLink } from "@/lib/domain/integrations";

export function HojeView() {
  const { data, isLoading, error } = useSnapshot();
  const enriched = useEnriched(data);
  const { session } = useRepo();
  const sctx = useScriptCtx();
  const navApp = useNavApp((x) => x.app);
  const { openDrawer, openQuickLog } = useUi();
  const t = useMemo(() => (data ? computeToday(data, enriched, session.timezone) : null), [data, enriched, session.timezone]);

  if (isLoading) return <Skeleton />;
  if (error || !data || !t) return <Card className="text-sm text-red-300">Erro ao carregar: {String(error)}</Card>;

  const noMrr = data.opportunities.filter(needsMrr);
  const visitById = new Map(data.visits.map((v) => [v.id, v]));
  const next = t.nextVisit;
  const nextAcc = next ? enriched.get(next.account_id) : null;
  const tz = session.timezone;

  const openOpps = data.opportunities.filter((o) => o.stage !== "fechado" && o.stage !== "perdido");
  const openOppOf = (accountId: string) => openOpps.find((o) => o.account_id === accountId);
  const pipelineOpen = openOpps.reduce((sum, o) => sum + Number(o.mrr_value), 0);
  const queueAcc = t.fuQueue.length ? enriched.get(t.fuQueue[0].account_id) : undefined;
  const noNext = t.alerts.filter((a) => a.kind === "sem_proxima_acao").length;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-white">Hoje</h1>
          <p className="text-xs text-slate-400">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: tz })}
          </p>
        </div>
      </div>

      {/* 6 KPIs */}
      <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @5xl:grid-cols-6">
        <Kpi label="Visitas hoje" value={`${t.visitsDoneToday}${t.visitsGoal ? ` / ${t.visitsGoal}` : ""}`}
          hint={t.visitsGoal ? `${t.visitsPlannedToday} na agenda` : `${t.visitsPlannedToday} na agenda · sem meta`}
          progress={t.visitsGoal ? t.visitsDoneToday / t.visitsGoal : undefined} />
        <Kpi label="Follow-ups" value={String(t.fuDueToday + t.fuOverdue)}
          hint={t.fuOverdue ? `${t.fuOverdue} vencido(s)` : "nenhum vencido"} danger={t.fuOverdue > 0} />
        <Kpi label="Propostas abertas" value={String(t.openProposals)} hint={noMrr.length ? `${noMrr.length} sem MRR` : "todas com MRR"} danger={noMrr.length > 0} />
        <Kpi label="Forecast" value={brl(t.forecast)} hint="MRR × probabilidade /mês" />
        <Kpi label="Pipeline aberto" value={brl(pipelineOpen)} hint={`${openOpps.length} oportunidade(s)`} />
        <Kpi label="MRR fechado no mês" value={brl(t.mrrMonth)} hint={noNext ? `${noNext} conta(s) sem próxima ação` : "funil sem buracos"} danger={noNext > 0} good={!noNext && t.mrrMonth > 0} />
      </div>

      <div className="grid grid-cols-1 gap-5 @4xl:grid-cols-5">
        <div className="min-w-0 space-y-5 @4xl:col-span-3">
          {/* Próxima visita com as opções de 1 clique abertas */}
          <Card className="border-brand-500/30 bg-gradient-to-br from-brand-600/10 to-slate-900/60">
            <SectionTitle>Próxima visita de campo</SectionTitle>
            {next && nextAcc ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button type="button" onClick={() => openDrawer(nextAcc.id)} title="Abrir ficha" className="text-left text-lg font-bold text-white underline decoration-slate-600 decoration-dotted underline-offset-4 hover:text-brand-300">
                      {nextAcc.name}
                    </button>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1 font-semibold text-amber-300"><Clock size={12} /> {timeInTz(next.scheduled_at, tz)} · {next.duration_minutes} min</span>
                      <span className="flex items-center gap-1"><MapPin size={12} /> {[nextAcc.address, nextAcc.neighborhood].filter(Boolean).join(" · ") || "Endereço não cadastrado"}</span>
                    </div>
                  </div>
                  <span className={cn("rounded-lg px-2 py-1 font-mono text-sm font-bold", scoreColor(nextAcc.commercial_score))}>{nextAcc.commercial_score}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge>{VISIT_TYPE_LABEL[next.visit_type]}</Badge>
                  <Badge>Persona: {PERSONA_LABEL[nextAcc.persona]}</Badge>
                </div>
                <LeadControls acc={nextAcc} openOpp={openOppOf(nextAcc.id)} visit={next} />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <LinkButton href={navLink(navApp, nextAcc)} icon={<Navigation size={15} />}>Abrir rota{navApp === "waze" ? " (Waze)" : ""}</LinkButton>
                  <LinkButton href={waLink(waNumber(nextAcc), preVisitScript(nextAcc, next, sctx, timeInTz(next.scheduled_at, tz)))}
                    icon={<MessageCircle size={15} />} whatsapp>WhatsApp pré-visita</LinkButton>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-400">Nenhuma visita pendente hoje. Use <b>Ctrl+K → Agendar visita</b> ou as ações em massa do CRM.</p>
                {queueAcc ? (
                  <div className="space-y-2 border-t border-slate-800 pt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Próximo da fila de follow-up</div>
                    <button type="button" onClick={() => openDrawer(queueAcc.id)} className="text-left text-base font-bold text-white underline decoration-slate-600 decoration-dotted underline-offset-4 hover:text-brand-300">
                      {queueAcc.name}
                    </button>
                    <LeadControls acc={queueAcc} openOpp={openOppOf(queueAcc.id)} />
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          {/* Agenda do dia */}
          <Card>
            <SectionTitle right={<Link href="/rotas" className="text-[11px] font-semibold text-brand-300 hover:underline">Otimizar rota →</Link>}>
              Agenda de hoje ({t.todayVisits.length})
            </SectionTitle>
            {t.todayVisits.length ? (
              <ol className="space-y-2">
                {t.todayVisits.map((v) => {
                  const a = enriched.get(v.account_id);
                  if (!a) return null;
                  const done = v.status === "realizada";
                  return (
                    <li key={v.id} className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-2.5">
                      <div className="flex items-center gap-3">
                        <span className="w-11 shrink-0 font-mono text-xs font-semibold text-amber-300">{timeInTz(v.scheduled_at, tz)}</span>
                        <button type="button" onClick={() => openDrawer(a.id)} className="min-w-0 flex-1 text-left">
                          <div className={cn("truncate text-sm font-semibold underline decoration-slate-600 decoration-dotted underline-offset-2", done ? "text-slate-500 line-through" : "text-white")}>{a.name}</div>
                          <div className="truncate text-[11px] text-slate-500">{a.neighborhood || "sem bairro"} · {VISIT_TYPE_LABEL[v.visit_type]} · {ACCOUNT_STATUS_LABEL[a.status]}</div>
                        </button>
                        {done ? (
                          <Badge className="bg-emerald-500/15 text-emerald-300">{v.outcome ? OUTCOME_LABEL[v.outcome] : "Realizada"}</Badge>
                        ) : (
                          <Button size="sm" variant="warn" onClick={() => openQuickLog(v.id)}><CalendarCheck size={13} /> Check-in</Button>
                        )}
                      </div>
                      {!done && v.id !== next?.id ? (
                        <div className="flex flex-wrap items-center gap-1.5 pl-14">
                          <TempPill acc={a} />
                          <SystemSelect acc={a} />
                          {openOppOf(a.id) ? <MrrChips opp={openOppOf(a.id)!} /> : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-slate-400">Sem visitas na agenda de hoje.</p>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5 @4xl:col-span-2">
          {/* Propostas sem MRR: sem valor, o forecast e o pipeline aberto ficam zerados */}
          {noMrr.length ? (
            <Card className="border-amber-500/30">
              <SectionTitle>Propostas sem MRR ({noMrr.length})</SectionTitle>
              <ul className="space-y-2">
                {noMrr.map((o) => (
                  <li key={o.id} className="space-y-1">
                    <button type="button" onClick={() => openDrawer(o.account_id)} className="block max-w-full truncate text-left text-sm font-semibold text-white underline decoration-slate-600 decoration-dotted underline-offset-2 hover:text-brand-300">
                      {enriched.get(o.account_id)?.name ?? o.title}
                    </button>
                    <QuickMrr opp={o} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* Follow-ups */}
          <Card>
            <SectionTitle right={<span className="hidden text-[11px] text-slate-500 sm:inline">atrasados primeiro</span>}>
              Follow-ups de hoje e atrasados ({t.fuQueue.length})
            </SectionTitle>
            {t.fuQueue.length ? (
              <ul className="space-y-2">
                {t.fuQueue.map((f) => {
                  const a = enriched.get(f.account_id);
                  return a ? <FollowUpRow key={f.id} fu={f} account={a} visit={f.visit_id ? visitById.get(f.visit_id) : undefined} today={t.today} /> : null;
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Fila zerada. 👏</p>
            )}
          </Card>

          {/* Radar de governança */}
          <Card>
            <SectionTitle>Radar de governança ({t.alerts.length})</SectionTitle>
            {t.alerts.length ? (
              <ul className="space-y-1.5">
                {t.alerts.slice(0, 12).map((al, i) => (
                  <li key={`${al.kind}-${al.accountId}-${i}`}>
                    <button type="button" onClick={() => openDrawer(al.accountId)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-slate-800/60",
                        al.kind === "sem_proxima_acao" ? "text-red-300" : al.kind === "parada" ? "text-amber-300" : "text-slate-300",
                      )}>
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {al.text}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Funil limpo.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, progress, danger, good }: { label: string; value: string; hint: string; progress?: number; danger?: boolean; good?: boolean }) {
  return (
    <Card className="min-w-0 p-3.5">
      <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={cn("mt-1 truncate whitespace-nowrap font-mono text-xl font-bold sm:text-2xl", danger ? "text-red-300" : good ? "text-emerald-300" : "text-white")} title={value}>{value}</div>
      {progress != null ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-gradient-to-r from-rose-600 to-emerald-400" style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }} />
        </div>
      ) : null}
      <div className={cn("mt-1 text-[11px]", danger ? "text-red-300/80" : "text-slate-500")}>{hint}</div>
    </Card>
  );
}

function LinkButton({ href, icon, children, whatsapp }: { href: string | null; icon: React.ReactNode; children: React.ReactNode; whatsapp?: boolean }) {
  const cls = cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition",
    whatsapp ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" : "bg-slate-800/70 text-slate-200 hover:bg-slate-700",
  );
  if (!href) return <span className={cn(cls, "pointer-events-none opacity-40")} title="Dado faltando no cadastro">{icon}{children}</span>;
  return <a className={cls} href={href} target="_blank" rel="noopener noreferrer">{icon}{children}</a>;
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-900" />)}
    </div>
  );
}
