"use client";
// Modelos de WhatsApp na ficha: escolhe o modelo, preenche {nome}/{restaurante}/{bairro}/{sistema} e abre o wa.me
// (ou envia pela API configurada em Integrações).
import { MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/primitives";
import { useOrgSettings, useWaTemplates } from "@/lib/data/settings";
import { type OrgSettings, fillTemplate, waApiRequest, waDigits } from "@/lib/domain/integrations";
import type { Account } from "@/lib/domain/types";

export async function sendViaApi(cfg: OrgSettings["whatsapp"], phone: string, text: string): Promise<boolean> {
  const req = waApiRequest(cfg, phone, text);
  if (!req) {
    toast.error("API de WhatsApp não configurada. Use o modo link ou configure em Integrações.");
    return false;
  }
  try {
    const r = await fetch(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body) });
    if (!r.ok) throw new Error(`a API respondeu ${r.status}`);
    toast.success("Mensagem enviada pela API.");
    return true;
  } catch (e) {
    toast.error(`Não enviou pela API (${e instanceof Error ? e.message : "erro de rede"}). Abra pelo link.`);
    return false;
  }
}

export function WaTemplates({ acc }: { acc: Account }) {
  const templates = useWaTemplates();
  const { data: settings } = useOrgSettings();
  const [id, setId] = useState(templates[0]?.id ?? "");
  const t = templates.find((x) => x.id === id) ?? templates[0];
  const phone = waDigits(acc.whatsapp || acc.phone);
  if (!t) return null;
  const text = fillTemplate(t.text, acc);
  const apiMode = settings?.whatsapp?.mode && settings.whatsapp.mode !== "link";
  return (
    <div className="space-y-1.5 rounded-lg border border-slate-800 p-2.5">
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-slate-400" htmlFor={`tpl-${acc.id}`}>Modelo</label>
        <select id={`tpl-${acc.id}`} className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
          value={t.id} onChange={(e) => setId(e.target.value)}>
          {templates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </div>
      <p className="whitespace-pre-line text-[11px] leading-relaxed text-slate-300">{text}</p>
      {phone ? (
        <div className="flex flex-wrap gap-1.5">
          <a href={`https://wa.me/${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300">
            <MessageCircle size={13} /> Abrir no WhatsApp
          </a>
          {apiMode ? (
            <Button size="sm" onClick={() => void sendViaApi(settings!.whatsapp, phone, text)}><Send size={13} /> Enviar pela API</Button>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] text-amber-300">Sem WhatsApp/telefone válido no cadastro.</p>
      )}
    </div>
  );
}
