// Datas de calendário (YYYY-MM-DD) sempre no fuso da org, igual ao SQL (org_today).

export const DEFAULT_TZ = "America/Sao_Paulo";

export function dateInTz(at: Date | string, tz: string = DEFAULT_TZ): string {
  const d = typeof at === "string" ? new Date(at) : at;
  // en-CA formata como YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function todayIn(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return dateInTz(now, tz);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** b - a, em dias de calendário */
export function diffDays(a: string, b: string): number {
  const toUtc = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function monthStart(date: string): string {
  return date.slice(0, 8) + "01";
}

export function timeInTz(at: string, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(at));
}

export function formatDateBR(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

export function relativeDayLabel(due: string, today: string): string {
  const d = diffDays(today, due);
  if (d === 0) return "Hoje";
  if (d === 1) return "Amanhã";
  if (d === -1) return "Ontem";
  if (d < 0) return `${-d} dias atrás`;
  return `Em ${d} dias`;
}

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Converte data+hora "de parede" no fuso da org para ISO UTC. */
export function zonedToIso(date: string, time: string, tz: string = DEFAULT_TZ): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (asIfUtc - guess)).toISOString();
}
