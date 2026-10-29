// Integrações sem login e sem custo: links "1 clique" para Gmail, Outlook/Hotmail, Google Agenda, Outlook Agenda,
// arquivo .ics (qualquer agenda do celular), pesquisa do restaurante (Google, Maps, iFood, Instagram, Drive) e Meet.
// Nada aqui pede OAuth: o vendedor já está logado no Gmail/Outlook do aparelho dele. Tudo puro (testável).
import type { Account, AccountStatus } from "./types";

// ---------------------------------------------------------------------------
// E-mail
// ---------------------------------------------------------------------------
export type EmailApp = "gmail" | "outlook" | "outlook365" | "mailto";
export const EMAIL_APPS: { id: EmailApp; label: string }[] = [
  { id: "gmail", label: "Gmail" },
  { id: "outlook", label: "Hotmail / Outlook.com" },
  { id: "outlook365", label: "Outlook corporativo (Microsoft 365)" },
  { id: "mailto", label: "App de e-mail do aparelho" },
];

export interface Mail {
  to?: string | null;
  subject: string;
  body: string;
}

export function composeLink(app: EmailApp, m: Mail): string {
  const to = (m.to ?? "").trim();
  const q = (o: Record<string, string>) =>
    Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  if (app === "gmail") return `https://mail.google.com/mail/?view=cm&fs=1&${q({ to, su: m.subject, body: m.body })}`;
  if (app === "outlook") return `https://outlook.live.com/mail/0/deeplink/compose?${q({ to, subject: m.subject, body: m.body })}`;
  if (app === "outlook365") return `https://outlook.office.com/mail/deeplink/compose?${q({ to, subject: m.subject, body: m.body })}`;
  return `mailto:${encodeURIComponent(to)}?${q({ subject: m.subject, body: m.body })}`;
}

/** Ordem do funil de contas (espelha account_status_rank no banco). */
export const STATUS_RANK: Record<AccountStatus, number> = {
  lead_frio: 0, novo_lead: 1, lead_importado: 1, a_validar: 1, primeiro_contato: 2, discovery: 3, agendado: 4,
  demo_realizada: 5, proposta_enviada: 6, negociacao: 7, fechado: 8, perdido: -1,
};

/** Etapa para onde a conta deve andar depois de uma ação; null = não mexe (nunca volta etapa, nunca reabre perdido/fechado). */
export function autoAdvance(current: AccountStatus, target: AccountStatus | undefined): AccountStatus | null {
  if (!target || current === "perdido" || current === "fechado") return null;
  return STATUS_RANK[current] < STATUS_RANK[target] ? target : null;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  /** ao enviar, a conta avança para esta etapa (se ainda estiver antes dela) */
  advance_to?: AccountStatus;
}

export const EMAIL_VARS = ["{nome}", "{restaurante}", "{bairro}", "{sistema}", "{vendedor}", "{empresa}", "{link_agenda}", "{link_proposta}"] as const;

export const DEFAULT_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: "e-proposta",
    name: "Enviar proposta",
    subject: "Proposta {empresa} para o {restaurante}",
    body: "Olá {nome}, tudo bem?\n\nConforme conversamos, segue a proposta para o {restaurante}: {link_proposta}\n\nResumo: pedidos do salão, delivery e balcão em um lugar só, sem comanda perdida no pico e com relatório de quanto você paga de comissão por mês.\n\nPosso te ligar amanhã para tirar as dúvidas?\n\nAbraço,\n{vendedor}\n{empresa}",
    advance_to: "proposta_enviada",
  },
  {
    id: "e-pos-visita",
    name: "Resumo pós-visita",
    subject: "Obrigado pela conversa, {nome}",
    body: "Olá {nome}!\n\nObrigado pelo tempo hoje no {restaurante}. Como combinamos, o próximo passo é uma demonstração rápida com a sua operação real. Escolha o melhor horário aqui: {link_agenda}\n\nAbraço,\n{vendedor}",
    advance_to: "primeiro_contato",
  },
  {
    id: "e-confirmar",
    name: "Confirmar visita/demonstração",
    subject: "Confirmando nossa conversa no {restaurante}",
    body: "Olá {nome}, tudo bem?\n\nPassando para confirmar nossa conversa. Se precisar mudar o horário, é só escolher outro aqui: {link_agenda}\n\nAté lá,\n{vendedor}",
  },
  {
    id: "e-boas-vindas",
    name: "Boas-vindas (pós-venda)",
    subject: "Bem-vindo à {empresa}, {restaurante}!",
    body: "Olá {nome}!\n\nSeja muito bem-vindo. Nos próximos 7 dias eu acompanho a implantação de perto. Qualquer dúvida, me chama por aqui ou no WhatsApp.\n\nAbraço,\n{vendedor}",
  },
  {
    id: "e-recuperacao",
    name: "Recuperação (+30 dias)",
    subject: "{nome}, como está a operação do {restaurante}?",
    body: "Olá {nome}, tudo bem?\n\nFaz um tempo que não conversamos. Muitos restaurantes de {bairro} estão reduzindo a comissão dos apps levando o cliente para o pedido próprio. Vale 15 minutos para eu te mostrar os números?\n\n{link_agenda}\n\nAbraço,\n{vendedor}",
  },
];

export interface LinkSettings {
  /** Calendly, Cal.com ou página de agendamento do Google Agenda */
  scheduling?: string;
  /** proposta padrão (PDF ou Doc no Drive) */
  proposal?: string;
  /** pasta de clientes no Google Drive / OneDrive */
  drive_folder?: string;
}

export interface VarCtx {
  seller: string;
  company: string;
  links?: LinkSettings;
}

type VarAccount = Pick<Account, "name" | "decision_maker_name" | "neighborhood" | "current_system">;

/** Preenche as variáveis; link vazio vira texto neutro para o e-mail não sair com "{link_agenda}". */
export function fillVars(text: string, a: VarAccount, c: VarCtx): string {
  const sys = a.current_system?.trim();
  const vals: Record<string, string> = {
    "{nome}": a.decision_maker_name?.trim().split(/\s+/)[0] ?? "",
    "{restaurante}": a.name.trim(),
    "{bairro}": a.neighborhood?.trim() ?? "",
    "{sistema}": sys && sys.toLowerCase() !== "a validar" ? sys : "o sistema atual",
    "{vendedor}": c.seller,
    "{empresa}": c.company,
    "{link_agenda}": c.links?.scheduling?.trim() || "(me responda com o melhor dia e horário)",
    "{link_proposta}": c.links?.proposal?.trim() || "(proposta em anexo)",
  };
  return text
    .replace(/\{(nome|restaurante|bairro|sistema|vendedor|empresa|link_agenda|link_proposta)\}/g, (m) => vals[m] ?? m)
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/(^|\n)[ \t]+/g, "$1")
    .trim();
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------
export interface CalEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  details?: string;
  location?: string;
}

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function googleCalendarLink(e: Omit<CalEvent, "uid">): string {
  const p = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${utcStamp(e.start)}/${utcStamp(e.end)}` });
  if (e.details) p.set("details", e.details);
  if (e.location) p.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export function outlookCalendarLink(e: Omit<CalEvent, "uid">, corporate = false): string {
  const p = new URLSearchParams({
    path: "/calendar/action/compose", rru: "addevent", subject: e.title,
    startdt: e.start.toISOString(), enddt: e.end.toISOString(),
  });
  if (e.details) p.set("body", e.details);
  if (e.location) p.set("location", e.location);
  return `${corporate ? "https://outlook.office.com" : "https://outlook.live.com"}/calendar/0/deeplink/compose?${p.toString()}`;
}

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
/** Linhas de no máximo 75 octetos (RFC 5545), continuação começa com espaço. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** Arquivo .ics: abre direto no Google Agenda, Outlook, Apple Calendar e na agenda do Android. */
export function buildIcs(events: CalEvent[], calName = "FieldOS CRM", now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FieldOS CRM//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(calName)}`,
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@fieldos-crm`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART:${utcStamp(e.start)}`,
      `DTEND:${utcStamp(e.end)}`,
      `SUMMARY:${icsEscape(e.title)}`,
      ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
      ...(e.details ? [`DESCRIPTION:${icsEscape(e.details)}`] : []),
      "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Lembrete", "TRIGGER:-PT30M", "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function addressOf(a: Pick<Account, "address" | "neighborhood" | "city">): string {
  return [a.address, a.neighborhood, a.city].map((x) => x?.trim()).filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// Pesquisa rápida do restaurante (antes da visita)
// ---------------------------------------------------------------------------
export interface QuickLink {
  id: string;
  label: string;
  href: string;
}

export function researchLinks(a: Pick<Account, "name" | "neighborhood" | "city" | "instagram_url" | "website_url">, driveFolder?: string): QuickLink[] {
  const where = [a.neighborhood, a.city ?? "Rio de Janeiro"].filter(Boolean).join(" ");
  const q = `${a.name} ${where}`.trim();
  const e = encodeURIComponent;
  const ig = a.instagram_url?.trim();
  const links: QuickLink[] = [
    { id: "google", label: "🔎 Google", href: `https://www.google.com/search?q=${e(q)}` },
    { id: "reviews", label: "⭐ Avaliações (Maps)", href: `https://www.google.com/maps/search/?api=1&query=${e(q)}` },
    { id: "ifood", label: "🛵 iFood", href: `https://www.google.com/search?q=${e(`${a.name} ${a.neighborhood ?? ""} site:ifood.com.br`)}` },
    {
      id: "instagram", label: "📸 Instagram",
      href: ig ? (ig.startsWith("http") ? ig : `https://www.instagram.com/${ig.replace(/^@/, "")}`) : `https://www.google.com/search?q=${e(`${a.name} ${a.neighborhood ?? ""} instagram`)}`,
    },
  ];
  if (a.website_url?.trim()) links.push({ id: "site", label: "🌐 Site / cardápio", href: a.website_url.trim().startsWith("http") ? a.website_url.trim() : `https://${a.website_url.trim()}` });
  links.push({ id: "drive", label: "📁 Drive", href: driveFolder?.trim() || `https://drive.google.com/drive/search?q=${e(a.name)}` });
  links.push({ id: "meet", label: "🎥 Google Meet", href: "https://meet.google.com/new" });
  return links;
}

/** Modelo de e-mail sugerido para a etapa atual (o botão 📧 dos cards usa este). */
export function suggestedEmailId(status: AccountStatus): string {
  switch (status) {
    case "demo_realizada": return "e-proposta";
    case "discovery": case "agendado": case "proposta_enviada": case "negociacao": return "e-confirmar";
    case "fechado": return "e-boas-vindas";
    case "perdido": return "e-recuperacao";
    default: return "e-pos-visita";
  }
}
