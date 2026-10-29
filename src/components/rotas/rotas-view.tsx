"use client";
// Rotas: o dia de campo em ordem, com KM/tempo e fonte da distância. A rota guarda só logística
// (ordem, KM, tempo); endereço e bairro continuam vindo da conta.
import {
  CalendarCheck, CalendarX, Crosshair, Flag, LocateFixed, MapPin, Navigation, Play, Route as RouteIcon, Settings2,
  Sparkles, Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge, Button, Card, SectionTitle, cn, scoreColor } from "@/components/ui/primitives";
import { useActions, useEnriched, useRepo, useSnapshot } from "@/lib/data/hooks";
import { ACCOUNT_STATUS_LABEL, VISIT_TYPE_LABEL } from "@/lib/domain/constants";
import { addDays, dateInTz, formatDateBR, timeInTz, zonedToIso } from "@/lib/domain/dates";
import type { EnrichedAccount } from "@/lib/domain/enrich";
import {
  DEFAULT_CIRCUITY, type LatLng, type LegEstimate, type Located, geocode, stackedPoints, googleMapsRoute, haversineKm, locate, mapsStop,
  normalizeKey, optimizeOrder, planTimes, straightLegs, streetLegs, sumLegs,
} from "@/lib/domain/geo";
import { routeFor } from "@/lib/domain/pipeline";
import type { Account, Visit } from "@/lib/domain/types";
import { useUi } from "@/lib/ui-store";
import { AccountLink } from "@/components/ui/account-link";
import { useNavApp } from "@/lib/data/settings";
import { navLink } from "@/lib/domain/integrations";

const OPEN = ["agendada", "em_andamento", "reagendada"];
const field = "rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-white focus:border-brand-500 focus:outline-none";

interface Settings {
  speedKmh: number;
  circuity: number;
  radiusKm: number;
}
const DEFAULTS: Settings = { speedKmh: 25, circuity: DEFAULT_CIRCUITY, radiusKm: 2 };
const SKEY = "fieldos-rotas-ajustes";

function useSettings() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SKEY);
      if (raw) setS({ ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) });
    } catch {
      /* sem storage: usa o padrão */
    }
  }, []);
  const save = (n: Settings) => {
    setS(n);
    try {
      localStorage.setItem(SKEY, JSON.stringify(n));
    } catch {
      /* ignore */
    }
  };
  return [s, save] as const;
}

const PRECISION_LABEL: Record<string, string> = { endereco: "endereço", rua: "rua", bairro: "bairro (aprox.)" };
function precisionOf(a: Account, loc: Located | null) {
  if (!loc) return { label: "sem local", cls: "bg-red-500/15 text-red-300" };
  if (loc.source === "bairro") return { label: "bairro (aprox.)", cls: "bg-amber-500/15 text-amber-300" };
  return { label: PRECISION_LABEL[a.geo_precision ?? "endereco"] ?? "endereço", cls: "bg-emerald-500/15 text-emerald-300" };
}

interface Plan {
  ids: string[]; // visitas na ordem proposta
  legs: LegEstimate[];
  source: "ruas" | "linha_reta";
  unlocated: number;
}

export function RotasView() {
  const { data, isLoading } = useSnapshot();
  const enriched = useEnriched(data);
  const { session } = useRepo();
  const actions = useActions();
  const { openQuickLog, openDrawer } = useUi();
  const tz = session.timezone;
  const today = dateInTz(new Date(), tz);
  const [date, setDate] = useState(today);
  const [settings, setSettings] = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adjustTimes, setAdjustTimes] = useState(false);
  const [startTime, setStartTime] = useState("09:00");
  const [progress, setProgress] = useState<string | null>(null);
  const navApp = useNavApp((x) => x.app);

  const route = data ? routeFor(data, session.userId, date) : undefined;
  const dayVisits = useMemo(
    () => (data?.visits ?? []).filter((v) => dateInTz(v.scheduled_at, tz) === date && v.status !== "cancelada"),
    [data, date, tz],
  );
  const open = useMemo(() => {
    const list = dayVisits.filter((v) => OPEN.includes(v.status));
    const saved = route && list.every((v) => v.route_id === route.id && v.route_order != null);
    return list.sort((a, b) =>
      saved ? (a.route_order ?? 0) - (b.route_order ?? 0) : a.scheduled_at.localeCompare(b.scheduled_at),
    );
  }, [dayVisits, route]);
  const done = dayVisits.filter((v) => !OPEN.includes(v.status));

  useEffect(() => {
    // vindo das ações em massa do CRM: /rotas?data=AAAA-MM-DD
    const d = new URLSearchParams(window.location.search).get("data");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d);
  }, []);
  useEffect(() => setPlan(null), [date, data]);
  useEffect(() => {
    if (open[0]) setStartTime(timeInTz(open[0].scheduled_at, tz));
  }, [open, tz]);

  if (isLoading || !data) return <div className="py-20 text-center text-sm text-slate-500">Carregando rotas…</div>;

  const accOf = (v: Visit) => enriched.get(v.account_id);
  const ordered = plan ? plan.ids.map((id) => open.find((v) => v.id === id)!).filter(Boolean) : open;
  const stops = ordered.map((v) => ({ v, a: accOf(v)!, loc: accOf(v) ? locate(accOf(v)!) : null })).filter((s) => s.a);
  const currentLegs = straightLegs(
    stops.filter((s) => s.loc).map((s) => s.loc!),
    origin,
    settings.circuity,
    settings.speedKmh,
  );
  const legs = plan?.legs ?? currentLegs;
  const tot = sumLegs(legs);
  const visitMin = stops.reduce((s, x) => s + x.v.duration_minutes, 0);
  const missingGeo = stops.filter((s) => s.a.latitude == null && s.a.address?.trim());

  const locateMe = () => {
    if (!navigator.geolocation) return toast.error("Este aparelho não informa a localização.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setOrigin({ lat: p.coords.latitude, lng: p.coords.longitude });
        toast.success("Partida: sua localização atual.");
      },
      () => toast.error("Localização negada. A rota começa na primeira parada."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const optimize = async () => {
    const located = stops.filter((s) => s.loc);
    const unlocated = stops.filter((s) => !s.loc);
    if (located.length < 2 && !origin) return toast.info("Com menos de 2 paradas localizadas não há o que otimizar.");
    setBusy("otimizando");
    const order = optimizeOrder(located.map((s) => s.loc!), origin);
    const pts = order.map((i) => located[i].loc!);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 7000);
    const street = await streetLegs(pts, origin, ctl.signal);
    clearTimeout(timer);
    const legsNew = street ?? straightLegs(pts, origin, settings.circuity, settings.speedKmh);
    setPlan({
      ids: [...order.map((i) => located[i].v.id), ...unlocated.map((s) => s.v.id)],
      legs: [...legsNew, ...unlocated.map(() => ({ km: 0, minutes: 0 }))],
      source: street ? "ruas" : "linha_reta",
      unlocated: unlocated.length,
    });
    setBusy(null);
    const before = sumLegs(currentLegs).km;
    const after = sumLegs(street ? straightLegs(pts, origin, settings.circuity, settings.speedKmh) : legsNew).km;
    toast.success(
      before - after > 0.2 ? `Ordem otimizada: ~${(before - after).toFixed(1)} km a menos que a ordem atual.` : "Ordem atual já é a mais curta.",
    );
  };

  const save = async () => {
    const ids = stops.map((s) => s.v.id);
    const times = adjustTimes ? planTimes(zonedToIso(date, startTime, tz), legs, stops.map((s) => s.v.duration_minutes)) : null;
    setBusy("salvando");
    await actions.saveRoute(
      {
        routeDate: date, visitIds: ids, km: tot.km, minutes: Math.round(tot.minutes + visitMin),
        source: plan?.source ?? "linha_reta", startTime: adjustTimes ? startTime : null, times,
      },
      times ? "Rota salva e horários ajustados." : "Rota salva.",
    );
    setBusy(null);
  };

  // Localiza em lote, respeitando 1 pedido/s do OpenStreetMap. Grava lat/lng na conta: vale para todas as rotas futuras.
  const geocodeList = async (list: { id: string; address: string | null; neighborhood: string | null; city: string | null }[]) => {
    if (!list.length) return;
    setBusy("geocodificando");
    let ok = 0;
    let viaCep = 0;
    for (const [i, a] of list.entries()) {
      setProgress(`${i + 1}/${list.length}`);
      if (i) await new Promise((r) => setTimeout(r, 1100));
      const hit = await geocode(a);
      if (hit) {
        ok++;
        if (hit.via === "cep") viaCep++;
        await actions.updateAccount(a.id, { latitude: hit.lat, longitude: hit.lng, geo_precision: hit.precision });
      }
    }
    setBusy(null);
    setProgress(null);
    const detail = viaCep ? ` (${viaCep} pelo CEP, precisão de rua)` : "";
    if (ok === list.length) toast.success(`${ok} endereço(s) localizados${detail}.`);
    else toast.warning(`${ok} de ${list.length} localizados${detail}. Os demais seguem no centro do bairro (aproximado).`);
  };
  const geocodeAll = () => geocodeList(missingGeo.map((s) => s.a));
  const baseMissing = [...enriched.values()].filter((a) => a.latitude == null && a.address?.trim());
  const stacked = stackedPoints(stops.filter((s) => s.loc?.source === "bairro").map((s) => s.loc!));

  const mapsUrl = googleMapsRoute(stops.map((s) => mapsStop(s.a)).filter(Boolean) as (LatLng | string)[], origin);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-white">Rotas</h1>
          <p className="text-xs text-slate-400">Visitas do dia em ordem, KM e tempo. Abre no Google Maps com todas as paradas.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" aria-label="Dia anterior" onClick={() => setDate(addDays(date, -1))}>‹</Button>
          <input aria-label="Data da rota" type="date" className={field} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <Button size="sm" variant="outline" aria-label="Próximo dia" onClick={() => setDate(addDays(date, 1))}>›</Button>
          {date !== today ? <Button size="sm" onClick={() => setDate(today)}>Hoje</Button> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Paradas" value={String(stops.length)} sub={done.length ? `${done.length} já feitas` : undefined} />
        <Stat label="Distância" value={`${tot.km.toFixed(1)} km`} sub={stacked >= 2 ? `${stacked} paradas sem endereço localizado` : plan?.source === "ruas" ? "por ruas (OSRM)" : `linha reta × ${settings.circuity}`} />
        <Stat label="Tempo total" value={fmtMin(tot.minutes + visitMin)} sub={`${fmtMin(tot.minutes)} dirigindo + ${fmtMin(visitMin)} em visita`} />
        <Stat
          label="Rota"
          value={route ? (route.status === "em_andamento" ? "Em andamento" : route.status === "concluida" ? "Concluída" : "Salva") : "Não salva"}
          sub={route?.estimated_km != null ? `${route.estimated_km} km (${route.distance_source === "ruas" ? "ruas" : "linha reta"})` : undefined}
        />
      </div>

      <Card>
        <SectionTitle
          right={
            <button type="button" className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200" onClick={() => setShowSettings((v) => !v)}>
              <Settings2 size={13} /> Ajustes
            </button>
          }
        >
          Roteiro de {formatDateBR(date)}
        </SectionTitle>

        {showSettings ? (
          <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-950 p-3 text-[11px] text-slate-400">
            <label className="space-y-1">Velocidade média (km/h)
              <input className={cn(field, "w-full")} type="number" min={5} max={80} value={settings.speedKmh}
                onChange={(e) => setSettings({ ...settings, speedKmh: Math.max(5, Number(e.target.value) || DEFAULTS.speedKmh) })} />
            </label>
            <label className="space-y-1">Fator ruas ÷ linha reta
              <input className={cn(field, "w-full")} type="number" step={0.05} min={1} max={2} value={settings.circuity}
                onChange={(e) => setSettings({ ...settings, circuity: Math.min(2, Math.max(1, Number(e.target.value) || DEFAULTS.circuity)) })} />
            </label>
            <label className="space-y-1">Raio do encaixe (km)
              <input className={cn(field, "w-full")} type="number" step={0.5} min={0.5} max={15} value={settings.radiusKm}
                onChange={(e) => setSettings({ ...settings, radiusKm: Math.max(0.5, Number(e.target.value) || DEFAULTS.radiusKm) })} />
            </label>
            <p className="col-span-3 text-[10px] text-slate-500">
              Usados só quando o cálculo por ruas não responde. Ficam salvos neste aparelho.
            </p>
            {baseMissing.length ? (
              <div className="col-span-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
                <Button size="sm" disabled={!!busy} onClick={() => void geocodeList(baseMissing)}>
                  <MapPin size={14} /> {busy === "geocodificando" ? `Localizando ${progress ?? ""}…` : `Localizar toda a base (${baseMissing.length})`}
                </Button>
                <span className="text-[10px] text-slate-500">
                  ~{Math.ceil((baseMissing.length * 1.2) / 60)} min com a tela aberta. Grava a coordenada em cada conta para todas as rotas e o encaixe.
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {stops.length ? (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={locateMe}>
                {origin ? <LocateFixed size={14} className="text-emerald-300" /> : <Crosshair size={14} />} {origin ? "Partindo daqui" : "Partir da minha localização"}
              </Button>
              <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void optimize()}>
                <Wand2 size={14} /> {busy === "otimizando" ? "Calculando…" : "Otimizar ordem"}
              </Button>
              {missingGeo.length ? (
                <Button size="sm" disabled={!!busy} onClick={() => void geocodeAll()}>
                  <MapPin size={14} /> {busy === "geocodificando" ? `Localizando ${progress ?? ""}…` : `Localizar ${missingGeo.length} endereço(s)`}
                </Button>
              ) : null}
              {mapsUrl ? (
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25">
                  <Navigation size={14} /> Abrir no Google Maps
                </a>
              ) : null}
              {navApp === "waze" && stops[0] && navLink("waze", stops[0].a) ? (
                <a href={navLink("waze", stops[0].a)!} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/15 px-2.5 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/25">
                  <Navigation size={14} /> Waze: 1ª parada
                </a>
              ) : null}
            </div>
            {stacked >= 2 ? (
              <p className="mb-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                {stacked} paradas estão no mesmo ponto (centro do bairro), porque o endereço ainda não foi localizado. Entre elas a distância
                aparece 0 e a ordem não pode ser otimizada. Toque em <b>Localizar {missingGeo.length} endereço(s)</b>: leva cerca de {Math.ceil(missingGeo.length * 1.2)} s e fica salvo na conta.
              </p>
            ) : null}
            {plan ? (
              <p className="mb-2 rounded-lg border border-brand-500/30 bg-brand-500/10 p-2 text-[11px] text-brand-200">
                Ordem proposta ({plan.source === "ruas" ? "distância real por ruas" : "estimativa em linha reta corrigida; o cálculo por ruas não respondeu"}).
                {plan.unlocated ? ` ${plan.unlocated} parada(s) sem localização ficaram no fim.` : ""} Confira e salve.
              </p>
            ) : null}

            <ol className="space-y-2">
              {stops.map((s, i) => {
                const prec = precisionOf(s.a, s.loc);
                const leg = plan ? plan.legs[i] : s.loc ? currentLegs[stops.filter((x) => x.loc).indexOf(s)] : undefined;
                const single = mapsStop(s.a);
                return (
                  <li key={s.v.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                    {leg && (leg.km > 0 || i > 0) ? (
                      <div className="mb-1.5 text-[10px] text-slate-500">↓ {leg.km.toFixed(1)} km · {fmtMin(leg.minutes)}</div>
                    ) : null}
                    <div className="flex items-start gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={() => openDrawer(s.a.id)} title="Abrir ficha" className="block max-w-full truncate text-left text-sm font-semibold text-slate-100 underline decoration-slate-600 decoration-dotted underline-offset-2 hover:text-brand-300">
                          {s.a.name}
                        </button>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                          <span className="font-mono text-slate-200">{timeInTz(s.v.scheduled_at, tz)}</span>
                          <span>{VISIT_TYPE_LABEL[s.v.visit_type]}</span>
                          <span>· {s.a.neighborhood ?? "sem bairro"}</span>
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", prec.cls)}>{prec.label}</span>
                        </div>
                        {s.a.address ? <div className="mt-0.5 truncate text-[11px] text-slate-500">{s.a.address}</div> : null}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button size="sm" variant="warn" onClick={() => openQuickLog(s.v.id)}><CalendarCheck size={13} /> Check-in</Button>
                      <Reschedule visit={s.v} tz={tz} />
                      <Button
                        size="sm"
                        onClick={() => {
                          const reason = window.prompt("Motivo do cancelamento (opcional):") ;
                          if (reason !== null) void actions.cancelVisit({ visitId: s.v.id, reason });
                        }}
                      >
                        <CalendarX size={13} /> Cancelar
                      </Button>
                      {single ? (
                        <a className="inline-flex items-center gap-1 rounded-lg bg-slate-800/70 px-2.5 py-1.5 text-xs font-semibold text-slate-200"
                          target="_blank" rel="noopener noreferrer" href={(navApp === "waze" ? navLink("waze", s.a) : null) ?? googleMapsRoute([single])!}>
                          <Navigation size={13} /> Ir{navApp === "waze" ? " (Waze)" : ""}
                        </a>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
              <label className="flex items-center gap-1.5 text-xs text-slate-300">
                <input type="checkbox" checked={adjustTimes} onChange={(e) => setAdjustTimes(e.target.checked)} />
                Ajustar horários pela rota, saindo às
              </label>
              <input aria-label="Hora de saída" type="time" className={cn(field, "py-1")} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              <Button size="sm" variant="primary" disabled={!!busy} onClick={() => void save()}>
                <RouteIcon size={14} /> {busy === "salvando" ? "Salvando…" : route ? "Atualizar rota" : "Salvar rota"}
              </Button>
              {route && route.status === "planejada" ? (
                <Button size="sm" variant="success" onClick={() => void actions.setRouteStatus({ routeId: route.id, status: "em_andamento" }, "Rota iniciada. Bom campo!")}>
                  <Play size={13} /> Iniciar
                </Button>
              ) : null}
              {route && route.status === "em_andamento" ? (
                <Button size="sm" variant="success" onClick={() => void actions.setRouteStatus({ routeId: route.id, status: "concluida" }, "Rota concluída.")}>
                  <Flag size={13} /> Concluir
                </Button>
              ) : null}
            </div>
            {adjustTimes ? (
              <p className="mt-1 text-[10px] text-slate-500">
                Cada chegada = saída anterior + deslocamento estimado (arredondado em 5 min). O follow-up de cada visita acompanha.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-slate-400">Nenhuma visita aberta em {formatDateBR(date)}. Planeje um dia de campo abaixo.</p>
        )}

        {done.length ? (
          <div className="mt-3 space-y-1 border-t border-slate-800 pt-3">
            {done.map((v) => (
              <div key={v.id} className="flex justify-between text-[11px] text-slate-500">
                <span className="flex min-w-0 items-center gap-1">✓ {accOf(v) ? <AccountLink id={accOf(v)!.id} name={accOf(v)!.name} /> : null}</span>
                <span>{v.status}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      {stops.length ? (
        <FitIn stops={stops.map((s) => s.loc).filter(Boolean) as Located[]} dayAccountIds={new Set(dayVisits.map((v) => v.account_id))}
          enriched={enriched} date={date} radiusKm={settings.radiusKm} />
      ) : null}

      <FieldDayPlanner date={date} tz={tz} enriched={enriched} settings={settings} origin={origin} busyDay={dayVisits.length > 0} />
    </div>
  );
}

function fmtMin(m: number) {
  const r = Math.round(m);
  return r >= 60 ? `${Math.floor(r / 60)}h${String(r % 60).padStart(2, "0")}` : `${r} min`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="min-w-0 p-3">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      {/* nowrap: valor nunca quebra no meio da palavra ("Sa/lva"); se faltar espaço, reticências */}
      <div className="mt-1 truncate whitespace-nowrap font-mono text-base font-extrabold text-white sm:text-lg" title={value}>{value}</div>
      {sub ? <div className="truncate text-[10px] text-slate-500" title={sub}>{sub}</div> : null}
    </Card>
  );
}

function Reschedule({ visit, tz }: { visit: Visit; tz: string }) {
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(dateInTz(visit.scheduled_at, tz));
  const [t, setT] = useState(timeInTz(visit.scheduled_at, tz));
  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Reagendar</Button>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <input aria-label="Nova data" type="date" className={cn(field, "py-1 text-xs")} value={d} onChange={(e) => setD(e.target.value)} />
      <input aria-label="Nova hora" type="time" className={cn(field, "py-1 text-xs")} value={t} onChange={(e) => setT(e.target.value)} />
      <Button size="sm" variant="primary" onClick={async () => {
        if (await actions.rescheduleVisit({ visitId: visit.id, scheduledAt: zonedToIso(d, t, tz) })) setOpen(false);
      }}>OK</Button>
      <Button size="sm" variant="outline" onClick={() => setOpen(false)}>×</Button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Encaixe: contas com ação vencida/hoje perto das paradas do dia
// ---------------------------------------------------------------------------
function FitIn({ stops, dayAccountIds, enriched, date, radiusKm }: {
  stops: Located[]; dayAccountIds: Set<string>; enriched: Map<string, EnrichedAccount>; date: string; radiusKm: number;
}) {
  const openSchedule = useUi((s) => s.openSchedule);
  const list = useMemo(() => {
    const out: { a: EnrichedAccount; km: number }[] = [];
    for (const a of enriched.values()) {
      if (a.status === "perdido" || dayAccountIds.has(a.id)) continue;
      const fu = a.next_followup;
      if (!fu || fu.due_date > date) continue;
      const loc = locate(a);
      if (!loc) continue;
      const km = Math.min(...stops.map((s) => haversineKm(s, loc)));
      if (km <= radiusKm) out.push({ a, km });
    }
    return out.sort((x, y) => x.km - y.km || y.a.commercial_score - x.a.commercial_score).slice(0, 8);
  }, [enriched, stops, dayAccountIds, date, radiusKm]);
  if (!list.length) return null;
  return (
    <Card>
      <SectionTitle>Encaixe na rota (até {radiusKm} km, com ação vencida ou para hoje)</SectionTitle>
      <ul className="space-y-1.5">
        {list.map(({ a, km }) => (
          <li key={a.id} className="flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2">
            <span className={cn("rounded px-1 font-mono text-[10px] font-bold", scoreColor(a.commercial_score))}>{a.commercial_score}</span>
            <span className="min-w-0 flex-1">
              <AccountLink id={a.id} name={a.name} className="text-xs font-semibold text-slate-100" />
              <span className="block truncate text-[10px] text-slate-500">{a.neighborhood} · {km.toFixed(1)} km · {a.next_followup?.title}</span>
            </span>
            <Button size="sm" onClick={() => openSchedule(a.id)}>Agendar</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Planejar dia de campo por bairro: quantas visitas cabem é calculado pela janela de horário
// ---------------------------------------------------------------------------
const PROSPECT = ["novo_lead", "lead_importado", "a_validar", "lead_frio", "primeiro_contato", "discovery"];

function FieldDayPlanner({ date, tz, enriched, settings, origin, busyDay }: {
  date: string; tz: string; enriched: Map<string, EnrichedAccount>; settings: Settings; origin: LatLng | null; busyDay: boolean;
}) {
  const actions = useActions();
  const { data } = useSnapshot();
  const [open, setOpen] = useState(!busyDay);
  useEffect(() => setOpen(!busyDay), [busyDay, date]);
  const [bairros, setBairros] = useState<string[]>([]);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [dur, setDur] = useState(30);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);

  const withFutureVisit = useMemo(
    () => new Set((data?.visits ?? []).filter((v) => OPEN.includes(v.status)).map((v) => v.account_id)),
    [data],
  );
  const counts = useMemo(() => {
    const m = new Map<string, { label: string; n: number }>();
    for (const a of enriched.values()) {
      if (!a.neighborhood || !PROSPECT.includes(a.status) || withFutureVisit.has(a.id)) continue;
      const k = normalizeKey(a.neighborhood);
      const cur = m.get(k) ?? { label: a.neighborhood, n: 0 };
      cur.n++;
      m.set(k, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [enriched, withFutureVisit]);

  const proposal = useMemo(() => {
    if (!bairros.length) return null;
    const cands = [...enriched.values()]
      .filter((a) => a.neighborhood && bairros.includes(normalizeKey(a.neighborhood)) && PROSPECT.includes(a.status)
        && !withFutureVisit.has(a.id) && !skip.has(a.id))
      .sort((a, b) => b.commercial_score - a.commercial_score);
    const located = cands.map((a) => ({ a, loc: locate(a) })).filter((x) => x.loc) as { a: EnrichedAccount; loc: Located }[];
    const order = optimizeOrder(located.map((x) => x.loc), origin);
    const seq = order.map((i) => located[i]);
    const legs = straightLegs(seq.map((x) => x.loc), origin, settings.circuity, settings.speedKmh);
    const startIso = zonedToIso(date, from, tz);
    const endMs = new Date(zonedToIso(date, to, tz)).getTime();
    const times = planTimes(startIso, legs, seq.map(() => dur));
    const fits: { a: EnrichedAccount; time: string; leg: LegEstimate }[] = [];
    seq.forEach((x, i) => {
      if (new Date(times[i]).getTime() + dur * 60_000 <= endMs) fits.push({ a: x.a, time: times[i], leg: legs[i] });
    });
    // capacidade depende da janela; o que passou do horário fica para outro dia
    const firstOut = fits.length < seq.length ? seq.length - fits.length : 0;
    return { fits, total: cands.length, firstOut, approx: located.filter((x) => x.loc.source === "bairro").length };
  }, [bairros, enriched, withFutureVisit, skip, origin, settings, date, from, to, dur, tz]);

  const schedule = async () => {
    if (!proposal?.fits.length) return;
    setRunning(true);
    const ids: string[] = [];
    for (const f of proposal.fits) {
      const id = await actions.scheduleVisit({ accountId: f.a.id, scheduledAt: f.time, visitType: "primeiro_contato", durationMinutes: dur }, { silent: true });
      if (id) ids.push(id);
    }
    const km = sumLegs(proposal.fits.map((f) => f.leg)).km;
    const min = sumLegs(proposal.fits.map((f) => f.leg)).minutes + dur * ids.length;
    // dia vazio: a rota sai pronta; dia que já tinha visitas: o vendedor otimiza tudo junto acima
    if (ids.length && !busyDay)
      await actions.saveRoute({ routeDate: date, visitIds: ids, km, minutes: Math.round(min), source: "linha_reta", startTime: from }, "Rota salva.");
    setRunning(false);
    toast.success(busyDay ? `${ids.length} visita(s) agendada(s). Use "Otimizar ordem" para encaixar com as que já existiam.` : `${ids.length} visita(s) agendada(s).`);
    setBairros([]);
    setSkip(new Set());
  };

  return (
    <Card>
      <SectionTitle
        right={busyDay ? <button type="button" className="text-[11px] text-slate-400 hover:text-slate-200" onClick={() => setOpen((v) => !v)}>{open ? "Fechar" : "Abrir"}</button> : null}
      >
        <span className="inline-flex items-center gap-1.5"><Sparkles size={13} /> Planejar dia de campo por bairro</span>
      </SectionTitle>
      {open ? (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-400">
            Escolha os bairros. O app pega os leads de prospecção com maior score, ordena pelo menor caminho e coloca quantos couberem na sua janela de horário.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {counts.map(([k, c]) => (
              <button key={k} type="button" onClick={() => setBairros((b) => (b.includes(k) ? b.filter((x) => x !== k) : [...b, k]))}
                className={cn("rounded-full border px-2.5 py-1 text-xs", bairros.includes(k) ? "border-brand-500 bg-brand-600/20 text-brand-200" : "border-slate-700 text-slate-300")}>
                {c.label} <span className="text-slate-500">{c.n}</span>
              </button>
            ))}
            {!counts.length ? <span className="text-xs text-slate-500">Nenhum lead de prospecção sem visita marcada.</span> : null}
          </div>
          <div className="flex flex-wrap items-end gap-2 text-[11px] text-slate-400">
            <label className="space-y-1">Das<input aria-label="Início do dia" type="time" className={cn(field, "block py-1")} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="space-y-1">Até<input aria-label="Fim do dia" type="time" className={cn(field, "block py-1")} value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <label className="space-y-1">Min por visita<input aria-label="Minutos por visita" type="number" min={10} max={180} className={cn(field, "block w-20 py-1")} value={dur} onChange={(e) => setDur(Math.max(10, Number(e.target.value) || 30))} /></label>
          </div>
          {proposal ? (
            <div className="space-y-1.5">
              <div className="text-xs text-slate-300">
                Cabem <b>{proposal.fits.length}</b> de {proposal.total} leads
                {proposal.firstOut ? ` (${proposal.firstOut} ficam para outro dia)` : ""}
                {proposal.approx ? ` · ${proposal.approx} com local aproximado pelo bairro` : ""}.
              </div>
              <ol className="space-y-1">
                {proposal.fits.map((f, i) => (
                  <li key={f.a.id} className="flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-1.5 text-xs">
                    <span className="w-5 text-slate-500">{i + 1}</span>
                    <span className="font-mono text-slate-200">{timeInTz(f.time, tz)}</span>
                    <span className="min-w-0 flex-1"><AccountLink id={f.a.id} name={f.a.name} className="text-slate-100" /></span>
                    <Badge>{ACCOUNT_STATUS_LABEL[f.a.status]}</Badge>
                    <button type="button" aria-label={`Tirar ${f.a.name}`} className="text-slate-500 hover:text-red-300"
                      onClick={() => setSkip((s) => new Set(s).add(f.a.id))}>×</button>
                  </li>
                ))}
              </ol>
              <Button variant="primary" disabled={running || !proposal.fits.length} onClick={() => void schedule()}>
                {running ? "Agendando…" : `Agendar ${proposal.fits.length} visitas e salvar rota`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
