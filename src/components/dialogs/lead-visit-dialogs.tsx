"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button, cn } from "@/components/ui/primitives";
import { VISIT_TYPE_LABEL } from "@/lib/domain/constants";
import { dateInTz, zonedToIso } from "@/lib/domain/dates";
import { findDuplicates } from "@/lib/domain/duplicates";
import type { VisitType } from "@/lib/domain/types";
import { useActions, useRepo, useSnapshot } from "@/lib/data/hooks";
import { useUi } from "@/lib/ui-store";

const input =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-brand-500 focus:outline-none";
// Sugestões (Fase 4: listas por org em organizations.settings)
const SYSTEMS = ["Saipos", "Yogga", "Anota AI", "iFood Gestor", "Goomer", "Consumer", "Colibri", "OlaClick", "MenuDino", "PlaceWeb", "F.Rest", "InstaDelivery", "Planilha / Manual", "A validar", "Outro"];
const NEIGHBORHOODS = ["Campo Grande", "Bangu", "Santa Cruz", "Paciência", "Jesuítas", "Jardim Palmares", "Inhoaíba", "Manguariba", "Conjunto Campinho", "Barra da Tijuca", "Recreio", "Posse", "Centro"];
// Região inferida só para bairros conhecidos; fora disso fica em branco (aparece em "dados incompletos").
const NEIGHBORHOOD_REGION: Record<string, string> = Object.fromEntries(
  ["Campo Grande", "Bangu", "Santa Cruz", "Barra da Tijuca", "Recreio", "Paciência", "Posse", "Palmares", "Jesuítas", "Jardim Palmares", "Inhoaíba", "Manguariba", "Conjunto Campinho"].map((n) => [n, "Oeste"]),
);
const SEGMENTS = ["Restaurante", "Pizzaria", "Hamburgueria", "Bar e Petisco", "Cafeteria", "Self-Service", "Delivery", "Lanchonete", "Açaiteria", "Churrascaria"];

export function NewLeadDialog() {
  const { newLeadOpen, setNewLead, openDrawer, openSchedule } = useUi();
  const actions = useActions();
  const { data } = useSnapshot();
  const [f, setF] = useState({ name: "", whatsapp: "", neighborhood: "", currentSystem: "", segment: "" });
  const [busy, setBusy] = useState(false);
  const [confirmDup, setConfirmDup] = useState(false);
  useEffect(() => {
    if (newLeadOpen) { setF({ name: "", whatsapp: "", neighborhood: "", currentSystem: "", segment: "" }); setConfirmDup(false); }
  }, [newLeadOpen]);
  const dups = useMemo(() => findDuplicates(data?.accounts ?? [], f.name, f.whatsapp).slice(0, 3), [data, f.name, f.whatsapp]);
  useEffect(() => setConfirmDup(false), [dups.length]);
  const blocked = busy || !f.name.trim() || (dups.length > 0 && !confirmDup);

  const submit = async (thenSchedule: boolean) => {
    setBusy(true);
    const region = NEIGHBORHOOD_REGION[f.neighborhood.trim()];
    const id = await actions.createLead({ ...f, region });
    setBusy(false);
    if (!id) return;
    setNewLead(false);
    if (thenSchedule) openSchedule(id);
    else openDrawer(id);
  };

  return (
    <Modal open={newLeadOpen} onOpenChange={setNewLead} title="Novo lead" description="Só o essencial. O follow-up Dia 0 da cadência já nasce criado."
      footer={
        <>
          <Button disabled={blocked} onClick={() => submit(true)}>Criar e agendar visita</Button>
          <Button variant="primary" disabled={blocked} onClick={() => submit(false)}>Criar lead</Button>
        </>
      }>
      <form className="space-y-2.5" onSubmit={(e) => { e.preventDefault(); if (!blocked) void submit(false); }}>
        <input className={input} autoFocus required placeholder="Nome do restaurante *" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className={input} inputMode="tel" placeholder="WhatsApp (DDD + número)" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} />
        <div className="grid grid-cols-2 gap-2.5">
          <input className={input} list="dl-bairros" placeholder="Bairro" value={f.neighborhood} onChange={(e) => setF({ ...f, neighborhood: e.target.value })} />
          <input className={input} list="dl-sistemas" placeholder="Sistema atual" value={f.currentSystem} onChange={(e) => setF({ ...f, currentSystem: e.target.value })} />
        </div>
        <input className={input} list="dl-segmentos" placeholder="Segmento" value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value })} />
        {dups.length ? (
          <div role="alert" className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-200">
            <div className="font-semibold">Possível duplicado: já existe na sua base</div>
            <ul className="space-y-1">
              {dups.map(({ account: a, reason }) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{a.name} <span className="text-amber-300/70">· mesmo {reason} · {a.neighborhood || "sem bairro"}</span></span>
                  <button type="button" className="shrink-0 font-semibold text-brand-300 hover:underline"
                    onClick={() => { setNewLead(false); openDrawer(a.id); }}>Abrir</button>
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2 text-amber-100">
              <input type="checkbox" checked={confirmDup} onChange={(e) => setConfirmDup(e.target.checked)} />
              É outro estabelecimento, criar mesmo assim
            </label>
          </div>
        ) : null}
        <datalist id="dl-bairros">{NEIGHBORHOODS.map((n) => <option key={n} value={n} />)}</datalist>
        <datalist id="dl-sistemas">{SYSTEMS.map((n) => <option key={n} value={n} />)}</datalist>
        <datalist id="dl-segmentos">{SEGMENTS.map((n) => <option key={n} value={n} />)}</datalist>
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}

const TYPES: VisitType[] = ["primeiro_contato", "demonstracao", "proposta", "retorno", "fechamento", "pos_venda"];

function nextSlot(tz: string) {
  const now = new Date();
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const h = Math.min(Number(hm.slice(0, 2)) + 1, 20);
  return `${String(h).padStart(2, "0")}:00`;
}

export function ScheduleVisitDialog() {
  const { schedule, closeSchedule } = useUi();
  const { data } = useSnapshot();
  const { session } = useRepo();
  const actions = useActions();
  const tz = session.timezone;
  const [accountId, setAccountId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(dateInTz(new Date(), tz));
  const [time, setTime] = useState(nextSlot(tz));
  const [type, setType] = useState<VisitType>("primeiro_contato");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (schedule.open) {
      setAccountId(schedule.accountId); setSearch(""); setDate(dateInTz(new Date(), tz)); setTime(nextSlot(tz)); setType("primeiro_contato");
    }
  }, [schedule.open, schedule.accountId, tz]);

  const acc = data?.accounts.find((a) => a.id === accountId);
  const matches = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.accounts ?? [])
      .filter((a) => a.status !== "perdido" || s)
      .filter((a) => !s || `${a.name} ${a.neighborhood ?? ""}`.toLowerCase().includes(s))
      .slice(0, 8);
  }, [data, search]);

  const submit = async () => {
    if (!accountId) return;
    setBusy(true);
    const ok = await actions.scheduleVisit({ accountId, scheduledAt: zonedToIso(date, time, tz), visitType: type });
    setBusy(false);
    if (ok) closeSchedule();
  };

  return (
    <Modal open={schedule.open} onOpenChange={(o) => !o && closeSchedule()} title="Agendar visita"
      description="A visita vira a próxima ação da conta (follow-up canal visita)."
      footer={<><Button onClick={closeSchedule}>Cancelar</Button><Button variant="primary" disabled={!accountId || busy} onClick={submit}>Agendar</Button></>}>
      <div className="space-y-3">
        {acc ? (
          <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm">
            <span className="font-semibold text-white">{acc.name}</span>
            {!schedule.accountId ? <button type="button" className="text-xs text-brand-300" onClick={() => setAccountId(null)}>trocar</button> : null}
          </div>
        ) : (
          <div className="space-y-1.5">
            <input className={input} autoFocus placeholder="Buscar restaurante…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {matches.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setAccountId(a.id)} className="w-full rounded-md px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800">
                    {a.name} <span className="text-slate-500">· {a.neighborhood || "sem bairro"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          <input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Data" />
          <input className={input} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Horário" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={cn("rounded-md px-2.5 py-1.5 text-xs font-semibold", type === t ? "bg-brand-600 text-white" : "bg-slate-800 text-slate-300")}>
              {VISIT_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
