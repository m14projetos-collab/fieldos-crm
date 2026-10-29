import { describe, expect, it } from "vitest";
import {
  applyCancelVisit, applyCreateOpportunity, applyMoveOpportunity, applyRescheduleVisit, applySaveRoute,
  applySetAccountStatus, applySetRouteStatus,
} from "./pipeline";
import { type Ctx, DomainError, applyCreateLead, applyScheduleVisit } from "./transitions";
import type { Snapshot } from "./types";
import { zonedToIso } from "./dates";

let n = 0;
const ctx = (now = new Date("2026-10-29T14:00:00Z")): Ctx => ({
  orgId: "org-a", userId: "user-a", tz: "America/Sao_Paulo", now, newId: () => `id-${++n}`,
});
const empty: Snapshot = { accounts: [], visits: [], opportunities: [], followUps: [], goals: [], routes: [], dailyLogs: [], playbooks: [] };
const pending = (s: Snapshot, acc: string) => s.followUps.filter((f) => f.account_id === acc && f.status === "pendente");
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : "OTHER";
  }
  return null;
};
const lead = (s: Snapshot, id: string) => applyCreateLead(s, { name: id }, ctx(), id);

describe("pipeline (paridade com 0009)", () => {
  it("cria, move, bloqueia sem MRR/motivo, fecha e mantém 1 próxima ação", () => {
    let s = lead(empty, "p1");
    expect(code(() => applyCreateOpportunity(s, { id: "o1", accountId: "p1", stage: "fechado" }, ctx()))).toBe("INVALID");
    s = applyCreateOpportunity(s, { id: "o1", accountId: "p1" }, ctx());
    expect(s.opportunities[0]).toMatchObject({ stage: "qualificado", probability: 35 });
    expect(s.accounts[0].status).toBe("discovery");
    expect(pending(s, "p1")).toHaveLength(1);
    expect(code(() => applyCreateOpportunity(s, { id: "o2", accountId: "p1" }, ctx()))).toBe("OPEN_OPP_EXISTS");
    expect(code(() => applyMoveOpportunity(s, { oppId: "o1", stage: "fechado" }, ctx()))).toBe("MRR_REQUIRED");
    expect(code(() => applyMoveOpportunity(s, { oppId: "o1", stage: "perdido" }, ctx()))).toBe("LOSS_REASON_REQUIRED");

    s = applyMoveOpportunity(s, { oppId: "o1", stage: "proposta_enviada" }, ctx());
    expect(s.accounts[0].status).toBe("proposta_enviada");
    expect(s.opportunities[0].proposal_sent_at).toBe("2026-10-29");
    expect(pending(s, "p1")).toHaveLength(1);
    expect(pending(s, "p1")[0].title).toMatch(/^Cobrar decisão/);

    s = applyMoveOpportunity(s, { oppId: "o1", stage: "qualificado" }, ctx());
    expect(s.accounts[0].status).toBe("proposta_enviada");
    expect(pending(s, "p1")).toHaveLength(1);

    s = applyMoveOpportunity(s, { oppId: "o1", stage: "fechado", mrr: 299 }, ctx());
    expect(s.accounts[0]).toMatchObject({ status: "fechado", post_sale_phase: "onboarding" });
    expect(s.opportunities[0]).toMatchObject({ mrr_value: 299, closed_at: "2026-10-29", probability: 100 });
    expect(pending(s, "p1")).toEqual([expect.objectContaining({ channel: "visita", due_date: "2026-11-05" })]);

    // upsell perdido não rebaixa o cliente
    s = applyCreateOpportunity(s, { id: "o3", accountId: "p1", mrr: 50 }, ctx());
    s = applyMoveOpportunity(s, { oppId: "o3", stage: "perdido", lossCategory: "preco" }, ctx());
    expect(s.accounts[0].status).toBe("fechado");
  });

  it("status da conta: cria oportunidade, não esconde negociação, perdido exige motivo", () => {
    let s = lead(empty, "p2");
    s = applySetAccountStatus(s, { accountId: "p2", status: "discovery" }, ctx());
    expect(pending(s, "p2")).toHaveLength(1);
    s = applySetAccountStatus(s, { accountId: "p2", status: "proposta_enviada", mrr: 199, newOppId: "o9" }, ctx());
    expect(s.opportunities).toEqual([expect.objectContaining({ id: "o9", stage: "proposta_enviada", mrr_value: 199 })]);
    expect(pending(s, "p2")).toHaveLength(1);
    expect(code(() => applySetAccountStatus(s, { accountId: "p2", status: "primeiro_contato" }, ctx()))).toBe("OPEN_OPP_EXISTS");
    expect(code(() => applySetAccountStatus(s, { accountId: "p2", status: "perdido" }, ctx()))).toBe("LOSS_REASON_REQUIRED");
    s = applySetAccountStatus(s, { accountId: "p2", status: "perdido", lossCategory: "ja_tem_sistema" }, ctx());
    expect(s.opportunities[0].stage).toBe("perdido");
    expect(pending(s, "p2")).toEqual([expect.objectContaining({ due_date: "2027-01-27", priority: "baixa" })]);
    s = applySetAccountStatus(s, { accountId: "p2", status: "primeiro_contato" }, ctx());
    expect(s.accounts[0]).toMatchObject({ status: "primeiro_contato", loss_reason: null });

    let t = lead(empty, "p3");
    t = applySetAccountStatus(t, { accountId: "p3", status: "fechado", mrr: 350, newOppId: "o10" }, ctx());
    expect(t.opportunities[0]).toMatchObject({ stage: "fechado", mrr_value: 350 });
    expect(t.accounts[0].status).toBe("fechado");
  });

  it("rotas: ordem, sem duplicar, fora do dia, reagendar e cancelar", () => {
    let s = lead(lead(empty, "r1"), "r2");
    const t10 = zonedToIso("2026-10-29", "10:00");
    const t14 = zonedToIso("2026-10-29", "14:00");
    s = applyScheduleVisit(s, { accountId: "r1", scheduledAt: t10, visitType: "primeiro_contato" }, ctx(), "v1");
    s = applyScheduleVisit(s, { accountId: "r2", scheduledAt: t14, visitType: "primeiro_contato" }, ctx(), "v2");
    const base = { routeDate: "2026-10-29", km: 12.34, minutes: 75, source: "linha_reta" as const };
    s = applySaveRoute(s, { ...base, id: "rt1", visitIds: ["v2", "v1"] }, ctx());
    expect(s.visits.find((v) => v.id === "v2")?.route_order).toBe(1);
    expect(s.routes[0]).toMatchObject({ id: "rt1", estimated_km: 12.3 });
    s = applySaveRoute(s, { ...base, id: "rt2", visitIds: ["v1"] }, ctx());
    expect(s.routes).toHaveLength(1);
    expect(s.visits.find((v) => v.id === "v2")?.route_id).toBeNull();
    expect(code(() => applySaveRoute(s, { ...base, routeDate: "2026-10-30", id: "x", visitIds: ["v1"] }, ctx()))).toBe("INVALID");

    s = applyRescheduleVisit(s, { visitId: "v1", scheduledAt: zonedToIso("2026-10-30", "10:00") }, ctx());
    expect(s.visits.find((v) => v.id === "v1")?.route_id).toBeNull();
    expect(s.followUps.find((f) => f.visit_id === "v1" && f.status === "pendente")?.due_date).toBe("2026-10-30");

    s = applyCancelVisit(s, { visitId: "v2", reason: "viajou" }, ctx());
    expect(s.visits.find((v) => v.id === "v2")?.status).toBe("cancelada");
    expect(s.followUps.some((f) => f.visit_id === "v2" && f.status === "pendente")).toBe(false);
    expect(code(() => applyCancelVisit(s, { visitId: "v2" }, ctx()))).toBe("INVALID");

    s = applySetRouteStatus(s, { routeId: "rt1", status: "cancelada" });
    s = applySaveRoute(s, { ...base, id: "rt3", visitIds: [] }, ctx());
    expect(s.routes.map((r) => r.id)).toEqual(["rt1", "rt3"]);
  });
});
