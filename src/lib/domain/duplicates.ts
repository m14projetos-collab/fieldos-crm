// Detecção de lead duplicado: mesmo nome (sem acento/pontuação) ou mesmo telefone.
import type { Account } from "./types";

export function normalizeName(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Últimos 10–11 dígitos (DDD + número), sem DDI 55. */
export function phoneKey(phone: string | null | undefined): string | null {
  let d = (phone || "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  return d.length >= 10 ? d : null;
}

export interface DuplicateMatch { account: Account; reason: "nome" | "telefone" }

export function findDuplicates(accounts: Account[], name: string, phone?: string | null): DuplicateMatch[] {
  const n = normalizeName(name);
  const p = phoneKey(phone);
  const out: DuplicateMatch[] = [];
  for (const a of accounts) {
    if (p && (phoneKey(a.whatsapp) === p || phoneKey(a.phone) === p)) out.push({ account: a, reason: "telefone" });
    else if (n.length >= 3 && normalizeName(a.name) === n) out.push({ account: a, reason: "nome" });
  }
  return out;
}
