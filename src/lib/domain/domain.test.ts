// Mesmo roteiro de supabase/tests/01_scenarios.sql, rodado nas regras TS.
// Se SQL e TS divergirem, um dos dois testes quebra.
import { describe, expect, it } from "vitest";
import { cadenceScript, waLink } from "./cadence";
import { addDays, dateInTz, diffDays } from "./dates";
import { commercialScore, enrichAll } from "./enrich";
import { computePain } from "./pain";
import { computeToday } from "./today";
import {
  type Ctx, DomainError, applyCompleteFollowUp, applyCreateLead, applyLogVisitOutcome, applyScheduleVisit,
} from "./transitions";
import type { Snapshot } from "./types";

let n = 0;
const ctx = (now = new Date("2026-10-29T14:00:00Z")): Ctx => ({
  orgId: "org-a", userId: "user-a", tz: "America/Sao_Paulo", now, newId: () => `id-${++n}`,
});
const empty: Snapshot = { accounts: [], visits: [], opportunities: [], followUps: [], goals: [], routes: [], dailyLogs: [], playbooks: [] };
const pending = (s: Snapshot, acc: string) => s.followUps.filter((f) => f.account_id === acc && f.status === "pendente");

describe("fluxo completo (paridade com o SQL)", () => {
  it("lead → cadência → visita → proposta → fechado, score 72", () => {
    const c = ctx();
    let s = applyCreateLead(empty, { name: "Pizzaria Bella Posse", whatsapp: "21999990001", neighborhood: "Campo Grande", region: "Oeste" }, c, "acc1");
    expect(pending(s, "acc1")).toHaveLength(1);
    expect(pending(s, "acc1")[0].cadence_step).toBe(0);

    // concluir Dia 0 sem próximo: bloqueado (conta vira ativa)
    const fu0 = pending(s, "acc1")[0].id;
    expect(() => applyCompleteFollowUp(s, { followUpId: fu0, result: "concluido" }, c)).toThrow(DomainError);

    s = applyCompleteFollowUp(s, { followUpId: fu0, result: "concluido", nextInDays: 2 }, c);
    expect(pending(s, "acc1")[0].cadence_step).toBe(2);
    expect(s.accounts[0].status).toBe("primeiro_contato");
    expect(s.accounts[0].cadence_day).toBe(2);

    s = applyScheduleVisit(s, { accountId: "acc1", scheduledAt: "2026-10-29T15:00:00Z", visitType: "primeiro_contato" }, c, "v1");
    expect(s.accounts[0].status).toBe("agendado");
    expect(pending(s, "acc1")).toHaveLength(2);

    s = applyLogVisitOutcome(s, { visitId: "v1", outcome: "proposta_solicitada", notes: "4 terminais" }, c);
    expect(s.accounts[0].status).toBe("demo_realizada");
    expect(s.accounts[0].interest_level).toBe("quente");
    expect(s.opportunities).toHaveLength(1);
    expect(s.opportunities[0].stage).toBe("demo_agendada");
    expect(pending(s, "acc1")).toHaveLength(1);
    expect(pending(s, "acc1")[0].channel).toBe("proposta");

    expect(() => applyLogVisitOutcome(s, { visitId: "v1", outcome: "fechado" }, c)).toThrow(/já está/);

    s = applyScheduleVisit(s, { accountId: "acc1", scheduledAt: "2026-10-29T16:00:00Z", visitType: "fechamento" }, c, "v2");
    s = applyLogVisitOutcome(s, { visitId: "v2", outcome: "fechado" }, c);
    expect(s.accounts[0].status).toBe("fechado");
    expect(s.accounts[0].post_sale_phase).toBe("onboarding");
    expect(s.opportunities).toHaveLength(1);
    expect(s.opportunities[0].stage).toBe("fechado");
    const today = dateInTz(c.now, c.tz);
    expect(diffDays(today, pending(s, "acc1")[0].due_date)).toBe(7);

    const e = enrichAll(s, c.now).get("acc1")!;
    expect(e.commercial_score).toBe(72);
    expect(e.funnel_stage).toBe("cliente");
    expect(e.missing_field).toBeNull();
  });

  it("sem interesse → perdido + recuperação em 90 dias", () => {
    const c = ctx();
    let s = applyCreateLead(empty, { name: "Smash Bangu", whatsapp: "21999990002", neighborhood: "Bangu", region: "Oeste" }, c, "acc2");
    s = applyScheduleVisit(s, { accountId: "acc2", scheduledAt: c.now.toISOString(), visitType: "primeiro_contato" }, c, "v3");
    s = applyLogVisitOutcome(s, { visitId: "v3", outcome: "sem_interesse" }, c);
    expect(s.accounts[0].status).toBe("perdido");
    expect(pending(s, "acc2")[0].due_date).toBe(addDays(dateInTz(c.now, c.tz), 90));
  });
});

describe("score", () => {
  const base = { priority: "alta", interest_level: "quente", status: "negociacao" } as const;
  const now = new Date("2026-10-29T12:00:00Z");
  it("limita a 100", () => {
    expect(commercialScore({ ...base, last_interaction_at: now.toISOString() }, 10, 10, 1, now)).toBe(100);
  });
  it("penaliza inatividade > 30 dias e nunca fica negativo", () => {
    expect(commercialScore({ priority: "baixa", interest_level: "frio", status: "novo_lead", last_interaction_at: "2026-08-01T00:00:00Z" }, 0, 0, 0, now)).toBe(1);
    expect(commercialScore({ priority: "baixa", interest_level: "frio", status: "novo_lead", last_interaction_at: null }, 0, 0, 0, now)).toBe(6);
  });
});

describe("hoje", () => {
  it("separa atrasados e de hoje, conta visitas do dia", () => {
    const c = ctx();
    let s = applyCreateLead(empty, { name: "A", whatsapp: "21999990003", neighborhood: "Recreio", region: "Oeste" }, c, "a");
    s = { ...s, followUps: s.followUps.map((f) => ({ ...f, due_date: "2026-10-25" })) };
    s = applyScheduleVisit(s, { accountId: "a", scheduledAt: "2026-10-29T18:00:00Z", visitType: "demonstracao" }, c, "vA");
    const t = computeToday(s, enrichAll(s, c.now), c.tz, c.now);
    expect(t.fuOverdue).toBe(1);
    expect(t.fuDueToday).toBe(1); // follow-up "Visita agendada"
    expect(t.visitsPlannedToday).toBe(1);
    expect(t.nextVisit?.id).toBe("vA");
  });

  it("fuso: 23h30 em SP ainda é o mesmo dia", () => {
    expect(dateInTz(new Date("2026-10-30T02:30:00Z"), "America/Sao_Paulo")).toBe("2026-10-29");
  });
});

describe("ancoragem e whatsapp", () => {
  it("calcula custo da inação e payback com premissas visíveis", () => {
    const r = computePain({ orders_month: 1000, avg_ticket: 50, commission_pct: 20, errors_month: 10, migration_share_pct: 20, system_price: 300 });
    expect(r.commissionMonth).toBe(10000);
    expect(r.commissionAvoidable).toBe(2000);
    expect(r.errorsMonth).toBe(500);
    expect(r.inactionCost).toBe(2500);
    expect(r.paybackDays).toBe(3.6);
  });
  it("monta link wa.me com DDI 55", () => {
    expect(waLink("(21) 99999-0001", "oi")).toBe("https://wa.me/5521999990001?text=oi");
    expect(waLink("", "oi")).toBeNull();
  });
  it("script sem decisor não inventa nome", () => {
    const c = ctx();
    const s = applyCreateLead(empty, { name: "Bar do Zé" }, c, "z");
    expect(cadenceScript(0, s.accounts[0], { sellerName: "Michel", companyName: "Takeat" })).toMatch(/^Olá, tudo bem\? Aqui é o Michel, da Takeat/);
  });
});

describe("fuso", () => {
  it("zonedToIso converte horário de SP para UTC", async () => {
    const { zonedToIso } = await import("./dates");
    expect(zonedToIso("2026-10-29", "14:30", "America/Sao_Paulo")).toBe("2026-10-29T17:30:00.000Z");
  });
});

describe("duplicidade", () => {
  const base = { id: "x", name: "Bar do Malaquias", phone: "(21) 3305-4643", whatsapp: "(21) 99762-9741" } as unknown as import("./types").Account;
  it("acha por nome sem acento/caixa/pontuação", async () => {
    const { findDuplicates } = await import("./duplicates");
    expect(findDuplicates([base], "bar do malaquías!")[0]?.reason).toBe("nome");
  });
  it("acha por telefone com ou sem DDI e máscara", async () => {
    const { findDuplicates } = await import("./duplicates");
    expect(findDuplicates([base], "Outro nome", "+55 21 99762-9741")[0]?.reason).toBe("telefone");
    expect(findDuplicates([base], "Outro nome", "2133054643")[0]?.reason).toBe("telefone");
  });
  it("não acusa nomes diferentes nem telefone curto", async () => {
    const { findDuplicates } = await import("./duplicates");
    expect(findDuplicates([base], "Bar do Malaquias 2", "9762")).toHaveLength(0);
  });
});

describe("whatsapp x fixo", () => {
  it("só usa o telefone para WhatsApp quando é celular", async () => {
    const { waNumber, isMobileBR } = await import("./cadence");
    expect(isMobileBR("(21) 99762-9741")).toBe(true);
    expect(isMobileBR("+55 21 99762-9741")).toBe(true);
    expect(isMobileBR("(21) 3251-1175")).toBe(false);
    expect(waNumber({ whatsapp: null, phone: "(21) 3251-1175" })).toBeNull();
    expect(waNumber({ whatsapp: null, phone: "(21) 99762-9741" })).toBe("(21) 99762-9741");
    expect(waNumber({ whatsapp: "(21) 3251-1175", phone: null })).toBe("(21) 3251-1175");
  });
});
