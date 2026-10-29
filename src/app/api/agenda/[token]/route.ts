// Assinatura de agenda (.ics): Google Agenda, Outlook e iPhone leem esta URL de tempos em tempos.
// Usa só a chave publicável: quem filtra é a função calendar_feed(token) no banco (security definer, só visitas do dono do token).
import { buildIcs, type CalEvent } from "@/lib/domain/links";

export const dynamic = "force-dynamic";

const TYPE: Record<string, string> = {
  primeiro_contato: "Primeiro contato", demonstracao: "Demonstração", proposta: "Proposta",
  retorno: "Retorno", fechamento: "Fechamento", pos_venda: "Pós-venda",
};

interface Row {
  id: string; scheduled_at: string; duration_minutes: number; visit_type: string; status: string;
  account_name: string; address: string | null; neighborhood: string | null; city: string | null;
  phone: string | null; decision_maker: string | null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "").toLowerCase();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!/^[0-9a-f]{64}$/.test(token) || !url || !key) return new Response("Link de agenda inválido.", { status: 404 });

  const r = await fetch(`${url}/rest/v1/rpc/calendar_feed`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token }),
    cache: "no-store",
  }).catch(() => null);
  if (!r || !r.ok) return new Response("Agenda indisponível no momento.", { status: 502 });
  const rows = (await r.json()) as Row[];

  const events: CalEvent[] = rows.map((v) => {
    const start = new Date(v.scheduled_at);
    return {
      uid: `visit-${v.id}`,
      title: `${v.status === "realizada" ? "✅ " : ""}Visita: ${v.account_name}`,
      start,
      end: new Date(start.getTime() + v.duration_minutes * 60_000),
      location: [v.address, v.neighborhood, v.city].filter(Boolean).join(", ") || undefined,
      details: `${TYPE[v.visit_type] ?? v.visit_type} · ${v.decision_maker ?? "decisor a confirmar"} · ${v.phone ?? "sem telefone"}`,
    };
  });
  return new Response(buildIcs(events, "FieldOS · Visitas"), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="fieldos-visitas.ics"',
      "Cache-Control": "private, max-age=300",
    },
  });
}
