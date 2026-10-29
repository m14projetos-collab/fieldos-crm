"use client";
// Command Palette global (Ctrl+K / Cmd+K): buscar conta, criar lead, agendar, WhatsApp, check-in.
import * as Dialog from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { CalendarCheck, CalendarPlus, MessageCircle, Plus, Sparkles, Store } from "lucide-react";
import { useState } from "react";
import { ACCOUNT_STATUS_LABEL } from "@/lib/domain/constants";
import { cadenceScript, followUpScript, waLink } from "@/lib/domain/cadence";
import { useEnriched, useScriptCtx, useSnapshot } from "@/lib/data/hooks";
import { useUi } from "@/lib/ui-store";

const item =
  "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-slate-300 data-[selected=true]:bg-brand-600/20 data-[selected=true]:text-white data-[disabled=true]:opacity-40";

export function CommandPalette() {
  const { paletteOpen, setPalette, openDrawer, setNewLead, openSchedule, openQuickLog } = useUi();
  const { data } = useSnapshot();
  const enriched = useEnriched(data);
  const sctx = useScriptCtx();
  const [q, setQ] = useState("");

  const close = () => { setPalette(false); setQ(""); };
  const run = (fn: () => void) => { close(); fn(); };

  const accounts = [...enriched.values()].sort((a, b) => b.commercial_score - a.commercial_score);
  const visits = new Map((data?.visits ?? []).map((v) => [v.id, v]));

  const whatsappFor = (id: string) => {
    const a = enriched.get(id);
    if (!a) return null;
    const fu = a.next_followup;
    const text = fu ? followUpScript(fu, a, sctx, fu.visit_id ? visits.get(fu.visit_id) : undefined) : cadenceScript(a.cadence_day, a, sctx);
    return waLink(a.whatsapp || a.phone, text);
  };

  return (
    <Dialog.Root open={paletteOpen} onOpenChange={(o) => (o ? setPalette(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="anim-pop fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
          <Dialog.Title className="sr-only">Command Palette</Dialog.Title>
          <Dialog.Description className="sr-only">Busque restaurantes e execute ações rápidas</Dialog.Description>
          <Command label="Command Palette" loop>
            <Command.Input
              value={q}
              onValueChange={setQ}
              autoFocus
              placeholder="Buscar restaurante, bairro, sistema… ou digite uma ação"
              className="w-full border-b border-slate-800 bg-transparent px-4 py-3.5 text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
            <Command.List className="max-h-[60vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-slate-500">Nada encontrado.</Command.Empty>

              <Command.Group heading="Ações" className="text-[11px] text-slate-500 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                <Command.Item className={item} onSelect={() => run(() => setNewLead(true))} keywords={["novo", "lead", "criar", "cadastrar"]}>
                  <Plus size={15} /> Criar lead
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => openSchedule(null))} keywords={["agendar", "visita", "agenda"]}>
                  <CalendarPlus size={15} /> Agendar visita
                </Command.Item>
                <Command.Item className={item} onSelect={() => run(() => openQuickLog())} keywords={["check-in", "checkin", "concluir", "visita", "estacionamento"]}>
                  <CalendarCheck size={15} /> Check-in de visita (Quick Log)
                </Command.Item>
                <Command.Item className={item} disabled keywords={["auditar", "chave", "conversa"]}>
                  <Sparkles size={15} /> Auditar conversa pelo Método CHAVE <span className="ml-auto text-[10px]">Fase 3</span>
                </Command.Item>
              </Command.Group>

              <Command.Group heading="Restaurantes" className="text-[11px] text-slate-500 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                {accounts.map((a) => (
                  <Command.Item
                    key={a.id}
                    value={`conta ${a.id}`}
                    keywords={[a.name, a.neighborhood ?? "", a.current_system ?? "", a.segment ?? "", a.decision_maker_name ?? ""]}
                    className={item}
                    onSelect={() => run(() => openDrawer(a.id))}
                  >
                    <Store size={15} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {a.name} <span className="text-slate-500">· {a.neighborhood || "sem bairro"} · {ACCOUNT_STATUS_LABEL[a.status]}</span>
                    </span>
                    <span className="font-mono text-xs text-slate-400">{a.commercial_score}</span>
                  </Command.Item>
                ))}
              </Command.Group>

              {q.trim().length >= 2 ? (
                <Command.Group heading="WhatsApp rápido" className="text-[11px] text-slate-500 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
                  {accounts.map((a) => {
                    const link = whatsappFor(a.id);
                    if (!link) return null;
                    return (
                      <Command.Item key={`wa-${a.id}`} value={`whatsapp ${a.id}`} keywords={["whatsapp", "zap", a.name, a.neighborhood ?? ""]} className={item}
                        onSelect={() => run(() => window.open(link, "_blank", "noopener,noreferrer"))}>
                        <MessageCircle size={15} className="text-emerald-400" /> WhatsApp para {a.name}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ) : null}
            </Command.List>
            <div className="border-t border-slate-800 px-4 py-2 text-[10px] text-slate-500">↑↓ navegar · Enter executar · Esc fechar</div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
