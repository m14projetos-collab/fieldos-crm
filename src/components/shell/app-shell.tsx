"use client";
import { CalendarCheck, Command, Gauge, KanbanSquare, Map as MapIcon, Plus, Search, Sparkles, Sun, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { AccountDialog } from "./account-dialog";
import { AccountDrawer } from "@/components/drawer/account-drawer";
import { NewLeadDialog, ScheduleVisitDialog } from "@/components/dialogs/lead-visit-dialogs";
import { MoveDialog } from "@/components/crm/move-dialog";
import { CommandPalette } from "@/components/palette/command-palette";
import { QuickLogDialog } from "@/components/quicklog/quick-log-dialog";
import { Button, cn } from "@/components/ui/primitives";
import { DemoRepo } from "@/lib/data/demo-repo";
import { useRepo } from "@/lib/data/hooks";
import { useUi } from "@/lib/ui-store";

const NAV = [
  { href: "/", label: "Hoje", icon: Sun, ready: true },
  { href: "/crm", label: "CRM", icon: KanbanSquare, ready: true },
  { href: "/rotas", label: "Rotas", icon: MapIcon, ready: false },
  { href: "/chave", label: "CHAVE", icon: Sparkles, ready: false },
  { href: "/performance", label: "Performance", icon: Gauge, ready: false },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const repo = useRepo();
  const { setPalette, openQuickLog, setNewLead } = useUi();
  const [accountOpen, setAccountOpen] = useState(false);
  const isSupabase = repo.session.mode === "supabase";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!useUi.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPalette]);

  return (
    <div className="min-h-dvh md:pl-56">
      {/* Sidebar desktop */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-slate-800 bg-slate-950/80 p-4 md:flex">
        <div className="mb-6">
          <div className="text-base font-extrabold text-white">FieldOS <span className="text-brand-400">CRM</span></div>
          <div className="truncate text-[11px] text-slate-500">{repo.session.orgName}</div>
        </div>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium",
                path === n.href ? "bg-brand-600/15 text-brand-300" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
              )}
            >
              <n.icon size={16} />
              <span className="flex-1">{n.label}</span>
              {!n.ready ? <span className="rounded bg-slate-800 px-1.5 text-[9px] text-slate-500">em breve</span> : null}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-2 text-[11px] text-slate-500">
          {repo.session.mode === "demo" ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-200">
              Modo demo: dados fictícios salvos só neste navegador.
              <button type="button" className="mt-1 block underline" onClick={() => (repo as DemoRepo).reset()}>
                Restaurar dados de exemplo
              </button>
            </div>
          ) : null}
          {isSupabase ? (
            <button type="button" onClick={() => setAccountOpen(true)} className="flex items-center gap-1.5 hover:text-slate-300">
              <UserRound size={13} /> {repo.session.userName}
            </button>
          ) : (
            <div>{repo.session.userName}</div>
          )}
        </div>
      </aside>

      {/* Topbar */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-800 bg-ink-950/90 px-4 py-3 backdrop-blur">
        <div className="text-sm font-extrabold text-white md:hidden">FieldOS</div>
        <button
          type="button"
          onClick={() => setPalette(true)}
          className="ml-auto flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-left text-sm text-slate-500 hover:border-slate-600 md:ml-0 md:max-w-md"
        >
          <Search size={15} />
          <span className="flex-1 truncate">Buscar restaurante ou ação…</span>
          <kbd className="hidden items-center gap-0.5 rounded border border-slate-700 px-1.5 text-[10px] sm:flex">
            <Command size={10} />K
          </kbd>
        </button>
        <Button variant="warn" size="sm" onClick={() => openQuickLog()} className="hidden sm:inline-flex">
          <CalendarCheck size={14} /> Check-in
        </Button>
        <Button variant="primary" size="sm" aria-label="Novo lead" onClick={() => setNewLead(true)}>
          <Plus size={14} /> <span className="hidden sm:inline">Novo lead</span>
        </Button>
        {isSupabase ? (
          <Button variant="ghost" size="sm" aria-label="Minha conta" onClick={() => setAccountOpen(true)} className="md:hidden">
            <UserRound size={15} />
          </Button>
        ) : null}
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 md:pb-10">{children}</main>

      {/* Bottom nav mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={cn("flex flex-col items-center gap-0.5 py-2 text-[10px]", path === n.href ? "text-brand-300" : "text-slate-500")}>
            <n.icon size={18} />
            {n.label.split(" ")[0]}
          </Link>
        ))}
      </nav>
      <button
        type="button"
        aria-label="Check-in de visita"
        onClick={() => openQuickLog()}
        className="fixed bottom-20 right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/30 sm:hidden"
      >
        <CalendarCheck size={22} />
      </button>

      <AccountDrawer />
      <QuickLogDialog />
      <CommandPalette />
      <NewLeadDialog />
      <ScheduleVisitDialog />
      <MoveDialog />
      {isSupabase ? <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} userName={repo.session.userName} /> : null}
    </div>
  );
}
