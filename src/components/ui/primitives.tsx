import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

type Variant = "primary" | "ghost" | "outline" | "success" | "warn" | "whatsapp";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 hover:bg-brand-500 text-white",
  ghost: "bg-slate-800/70 hover:bg-slate-700 text-slate-200",
  outline: "border border-slate-700 hover:border-slate-500 text-slate-200",
  success: "bg-emerald-600 hover:bg-emerald-500 text-white",
  warn: "bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30",
  whatsapp: "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30",
};

export function Button({
  variant = "ghost", size = "md", className, ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-brand-400",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        variants[variant],
        className,
      )}
      {...p}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-2xl border border-slate-800 bg-slate-900/60 p-4", className)}>{children}</section>;
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold bg-slate-800 text-slate-300", className)}>
      {children}
    </span>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">{children}</h2>
      {right}
    </div>
  );
}

export function scoreColor(score: number) {
  if (score >= 70) return "text-emerald-300 bg-emerald-500/15";
  if (score >= 45) return "text-amber-300 bg-amber-500/15";
  return "text-slate-300 bg-slate-700/50";
}
