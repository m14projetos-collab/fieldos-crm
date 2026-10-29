"use client";
// "📖 Script recomendado": escolhe o playbook pela etapa da venda e o battlecard pelo sistema atual da conta.
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { recommendScripts } from "@/lib/domain/playbooks";
import { PERSONA_LABEL } from "@/lib/domain/constants";
import type { Account, Playbook } from "@/lib/domain/types";

export function RecommendedScript({ acc, playbooks }: { acc: Account; playbooks: Playbook[] }) {
  const recs = recommendScripts(acc, playbooks);
  if (!recs.length) return null;
  return (
    <details className="group rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3">
      <summary className="cursor-pointer list-none text-xs font-bold uppercase tracking-wide text-indigo-200">
        📖 Script recomendado para este cliente <span className="font-normal normal-case text-slate-400">({recs.map((r) => r.title).join(" + ")})</span>
      </summary>
      <p className="mt-1 text-[10px] text-slate-500">
        Sistema atual: {acc.current_system || "a validar"} · Persona: {PERSONA_LABEL[acc.persona]}
      </p>
      <div className="mt-2 space-y-3">
        {recs.map((r) => (
          <div key={r.key}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-white">{r.title}</div>
                <div className="text-[10px] text-indigo-300">{r.why}{r.playbookId ? "" : " · versão padrão"}</div>
              </div>
              <button type="button" aria-label={`Copiar ${r.title}`} className="p-1 text-slate-500 hover:text-slate-200"
                onClick={() => navigator.clipboard.writeText(r.content_md).then(() => toast.success("Script copiado."), () => toast.error("Não consegui copiar."))}>
                <Copy size={13} />
              </button>
            </div>
            <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-300">{r.content_md}</p>
          </div>
        ))}
      </div>
    </details>
  );
}
