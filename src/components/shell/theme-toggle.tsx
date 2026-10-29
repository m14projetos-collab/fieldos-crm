"use client";
// Alterna M14 Dark ↔ Daylight (modo claro para usar na rua). Fica salvo neste aparelho.
import { useEffect, useState } from "react";
import { cn } from "@/components/ui/primitives";

export const THEME_KEY = "fieldos:theme";
/** Roda antes da pintura (no <head>) para não piscar o tema errado. */
export const THEME_BOOT = `try{if(localStorage.getItem("${THEME_KEY}")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export function ThemeToggle({ className }: { className?: string }) {
  const [light, setLight] = useState(false);
  useEffect(() => setLight(document.documentElement.dataset.theme === "light"), []);
  const toggle = () => {
    const next = !light;
    setLight(next);
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, next ? "light" : "dark");
    } catch {
      /* sem armazenamento: vale até recarregar */
    }
  };
  return (
    <button type="button" onClick={toggle} aria-pressed={light} title={light ? "Voltar ao M14 Dark" : "Modo claro para usar no sol"}
      className={cn("rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-300 hover:border-slate-600", className)}>
      <span className="sm:hidden">{light ? "🌙" : "☀️"}</span>
      <span className="hidden sm:inline">{light ? "🌙 M14 Dark" : "☀️ Daylight"}</span>
    </button>
  );
}
