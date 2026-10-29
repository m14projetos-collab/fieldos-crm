// Integrações: modelos de WhatsApp com variáveis, webhooks de saída, app de navegação e CSV.
// Tudo puro (testável). A configuração da org fica em organizations.settings (jsonb, só admin altera).
import type { Account } from "./types";

// ---------------------------------------------------------------------------
// Configuração da org
// ---------------------------------------------------------------------------
export type WaMode = "link" | "evolution" | "zapi";
export interface WaTemplate {
  id: string;
  name: string;
  text: string;
}
export const WEBHOOK_EVENTS = [
  { id: "visit.checkin", label: "Check-in de visita (visita realizada)" },
  { id: "proposal.sent", label: "Proposta enviada" },
  { id: "deal.won", label: "Venda fechada" },
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["id"];

export interface OrgSettings {
  whatsapp?: {
    mode: WaMode;
    base_url?: string; // Evolution: URL do servidor
    instance?: string; // Evolution: nome da instância · Z-API: id da instância
    token?: string; // Evolution: apikey · Z-API: token da instância
    client_token?: string; // Z-API: Client-Token da conta
    templates: WaTemplate[];
  };
  webhook?: { enabled: boolean; url: string; events: WebhookEvent[] };
}

export const TEMPLATE_VARS = ["{nome}", "{restaurante}", "{bairro}", "{sistema}"] as const;

export const DEFAULT_TEMPLATES: WaTemplate[] = [
  {
    id: "t-primeiro-contato",
    name: "Primeiro contato",
    text: "Olá {nome}, tudo bem? Passei pelo {restaurante} aqui em {bairro} e queria entender como está o controle de pedidos no horário de pico. Posso te fazer 2 perguntas rápidas?",
  },
  {
    id: "t-sistema",
    name: "Quem já usa sistema",
    text: "Olá {nome}! Vi que o {restaurante} usa {sistema}. Se você pudesse mudar uma coisa nele, o que seria?",
  },
  {
    id: "t-pre-visita",
    name: "Confirmar visita",
    text: "Olá {nome}, tudo certo para eu passar no {restaurante} hoje? Levo 15 minutos para te mostrar como fica a operação.",
  },
];

/** Preenche {nome}, {restaurante}, {bairro}, {sistema}. Variável sem dado some sem deixar espaço ou vírgula sobrando. */
export function fillTemplate(text: string, a: Pick<Account, "name" | "decision_maker_name" | "neighborhood" | "current_system">): string {
  const sys = a.current_system?.trim();
  const vals: Record<string, string> = {
    "{nome}": a.decision_maker_name?.trim().split(/\s+/)[0] ?? "",
    "{restaurante}": a.name.trim(),
    "{bairro}": a.neighborhood?.trim() ?? "",
    "{sistema}": sys && sys.toLowerCase() !== "a validar" ? sys : "o sistema atual",
  };
  return text
    .replace(/\{(nome|restaurante|bairro|sistema)\}/g, (m) => vals[m] ?? m)
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(^|\n)[ \t]+/g, "$1")
    .trim();
}

/** Número no formato internacional só com dígitos (55 + DDD + número). null se inválido. */
export function waDigits(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return null;
}

export interface WaRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, string>;
}

/** Monta o envio pela API escolhida (Evolution API ou Z-API). null = modo link (wa.me) ou config incompleta. */
export function waApiRequest(cfg: OrgSettings["whatsapp"], phone: string, text: string): WaRequest | null {
  if (!cfg || cfg.mode === "link" || !cfg.instance?.trim() || !cfg.token?.trim()) return null;
  if (cfg.mode === "evolution") {
    if (!cfg.base_url?.trim()) return null;
    return {
      url: `${cfg.base_url.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(cfg.instance.trim())}`,
      headers: { "Content-Type": "application/json", apikey: cfg.token.trim() },
      body: { number: phone, text },
    };
  }
  return {
    url: `https://api.z-api.io/instances/${encodeURIComponent(cfg.instance.trim())}/token/${encodeURIComponent(cfg.token.trim())}/send-text`,
    headers: { "Content-Type": "application/json", ...(cfg.client_token?.trim() ? { "Client-Token": cfg.client_token.trim() } : {}) },
    body: { phone, message: text },
  };
}

/** URL https pública (webhook). Bloqueia http, localhost e IPs de rede interna. */
export function isSafeWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:") return false;
    const h = u.hostname;
    if (h === "localhost" || h.endsWith(".local") || /^(10|127|192\.168|169\.254)\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    return h.includes(".");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------
export type NavApp = "google" | "waze";

export function navLink(app: NavApp, a: Pick<Account, "latitude" | "longitude" | "address" | "neighborhood" | "city">): string | null {
  const hasPt = a.latitude != null && a.longitude != null;
  const q = [a.address, a.neighborhood, a.city].filter(Boolean).join(", ");
  if (!hasPt && !q) return null;
  if (app === "waze")
    return hasPt
      ? `https://waze.com/ul?ll=${a.latitude},${a.longitude}&navigate=yes`
      : `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes`;
  return hasPt
    ? `https://www.google.com/maps/dir/?api=1&destination=${a.latitude},${a.longitude}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
/** Parser CSV (RFC 4180): aspas, vírgula ou ponto e vírgula (Excel pt-BR), quebra de linha dentro de aspas. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Colunas que o importador sabe atualizar (as mesmas que a ficha edita). Status muda pelo pipeline, não por planilha. */
export const CSV_COLUMNS = [
  "id", "name", "phone", "whatsapp", "email", "decision_maker_name", "address", "neighborhood", "region", "city",
  "segment", "current_system", "priority", "interest_level", "persona", "preferred_channel", "instagram_url", "notes",
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];
const EXPORT_EXTRA = ["status", "latitude", "longitude", "geo_precision", "created_at"] as const;

export function toCsv(accounts: Account[]): string {
  const cols = [...CSV_COLUMNS, ...EXPORT_EXTRA];
  const lines = [cols.join(",")];
  for (const a of accounts) lines.push(cols.map((c) => csvCell((a as unknown as Record<string, unknown>)[c])).join(","));
  return "﻿" + lines.join("\r\n");
}

const ENUMS: Partial<Record<CsvColumn, readonly string[]>> = {
  priority: ["alta", "media", "baixa"],
  interest_level: ["frio", "morno", "quente"],
  persona: ["dono_operacional", "socio_financeiro", "gerente_contratado"],
  preferred_channel: ["whatsapp", "ligacao", "visita", "email", "instagram", "indicacao", "evento", "cliente_antigo", "recuperacao"],
};
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** Aceita "Alta", "média", "Ligação": devolve o slug do banco. */
function enumValue(col: CsvColumn, v: string): string | null {
  const allowed = ENUMS[col];
  if (!allowed) return v;
  const f = fold(v).replace(/\s+/g, "_");
  return allowed.find((x) => x === f) ?? null;
}

export interface ImportPlan {
  updates: { id: string; name: string; patch: Partial<Account> }[];
  creates: { row: number; data: Partial<Account> & { name: string } }[];
  skipped: { row: number; reason: string }[];
  unchanged: number;
}

/**
 * Plano de importação, sem gravar nada: casa a linha pela coluna id ou, sem id, por nome + bairro.
 * Só campos com valor na planilha entram (célula vazia não apaga dado). Valor inválido de lista é ignorado com aviso.
 */
export function planImport(rows: string[][], existing: Account[]): ImportPlan {
  const plan: ImportPlan = { updates: [], creates: [], skipped: [], unchanged: 0 };
  if (rows.length < 2) return plan;
  const header = rows[0].map((h) => fold(h).replace(/\s+/g, "_"));
  const idx = new Map<CsvColumn, number>();
  for (const c of CSV_COLUMNS) {
    const i = header.indexOf(c);
    if (i >= 0) idx.set(c, i);
  }
  if (!idx.has("name") && !idx.has("id")) {
    plan.skipped.push({ row: 1, reason: "Cabeçalho sem as colunas name ou id" });
    return plan;
  }
  const byId = new Map(existing.map((a) => [a.id, a]));
  const key = (name: string, bairro: string | null | undefined) => `${fold(name)}|${fold(bairro ?? "")}`;
  const byName = new Map(existing.map((a) => [key(a.name, a.neighborhood), a]));
  rows.slice(1).forEach((r, k) => {
    const rowNo = k + 2;
    const data: Record<string, string> = {};
    for (const [c, i] of idx) {
      const v = (r[i] ?? "").trim();
      if (!v || c === "id") continue;
      const ev = enumValue(c, v);
      if (ev == null) {
        plan.skipped.push({ row: rowNo, reason: `${c} = "${v}" não é um valor válido (ignorado)` });
        continue;
      }
      data[c] = ev;
    }
    const id = idx.has("id") ? (r[idx.get("id")!] ?? "").trim() : "";
    const match = (id && byId.get(id)) || (data.name ? byName.get(key(data.name, data.neighborhood)) : undefined);
    if (id && !byId.get(id) && !match) {
      plan.skipped.push({ row: rowNo, reason: `id ${id} não existe nesta conta` });
      return;
    }
    if (match) {
      const patch: Record<string, string> = {};
      for (const [c, v] of Object.entries(data)) if (String((match as unknown as Record<string, unknown>)[c] ?? "") !== v) patch[c] = v;
      if (Object.keys(patch).length) plan.updates.push({ id: match.id, name: match.name, patch: patch as Partial<Account> });
      else plan.unchanged++;
      return;
    }
    if (!data.name) {
      plan.skipped.push({ row: rowNo, reason: "Linha sem nome" });
      return;
    }
    plan.creates.push({ row: rowNo, data: data as unknown as Partial<Account> & { name: string } });
  });
  return plan;
}
