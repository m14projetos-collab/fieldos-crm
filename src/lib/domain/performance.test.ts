import { describe, expect, it } from "vitest";
import { buildDemoSnapshot } from "@/lib/data/demo-seed";
import { enrichAll, funnelReach } from "./enrich";
import { conversionBy, funnel, goalActual, goalStatus, goalWindow, monthEnd, weekStart, workdays } from "./performance";
import type { Goal } from "./types";

const TZ = "America/Sao_Paulo";
const g = (p: Partial<Goal>): Goal => ({ id: "g", org_id: "o", owner_id: null, title: "t", category: "visitas", period_type: "diaria",
  start_date: "2026-01-01", end_date: "2026-12-31", target_value: 6, ...p });

describe("metas recorrentes (paridade com vw_goal_progress 0010)", () => {
  it("janelas: dia, semana seg-dom, mês, recortadas pela validade", () => {
    expect(weekStart("2026-10-29")).toBe("2026-10-26"); // quinta → segunda
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // domingo → segunda anterior
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(goalWindow(g({}), "2026-10-29")).toEqual({ start: "2026-10-29", end: "2026-10-29" });
    expect(goalWindow(g({ period_type: "mensal", start_date: "2026-10-15" }), "2026-10-29")).toEqual({ start: "2026-10-15", end: "2026-10-31" });
    expect(goalWindow(g({ end_date: "2026-10-01" }), "2026-10-29")).toBeNull();
  });

  it("realizado vem dos registros e ritmo considera dias úteis", () => {
    const now = new Date("2026-10-29T18:00:00Z");
    const s = buildDemoSnapshot(TZ, now);
    const today = "2026-10-29";
    // demo: 1 visita realizada hoje (v0) e 1 venda hoje (o7, MRR 289)
    expect(goalActual(g({}), s, TZ, today)).toBe(s.visits.filter((v) => v.status === "realizada" && v.completed_at?.startsWith("2026-10-29")).length);
    expect(goalActual(g({ category: "vendas", period_type: "mensal" }), s, TZ, today)).toBe(1);
    expect(goalActual(g({ category: "receita_mrr", period_type: "mensal" }), s, TZ, today)).toBe(289);
    const st = goalStatus(g({ category: "vendas", period_type: "mensal", target_value: 8 }), s, TZ, today);
    expect(workdays("2026-10-01", "2026-10-31")).toBe(27);
    expect(st.state).toBe("atras");
    expect(st.perDayNeeded).toBeCloseTo(7 / workdays(today, "2026-10-31"));
  });
});

describe("regra de MQL (29/10)", () => {
  it("morno importado sem contato é Lead; morno com contato, quente ou score ≥ 40 é MQL; SQL e cliente por etapa", () => {
    expect(funnelReach({ status: "lead_importado", interest_level: "morno" }, [], 33)).toBe(0);
    expect(funnelReach({ status: "primeiro_contato", interest_level: "morno" }, [], 33)).toBe(1);
    expect(funnelReach({ status: "lead_importado", interest_level: "quente" }, [], 10)).toBe(1);
    expect(funnelReach({ status: "lead_importado", interest_level: "frio" }, [], 40)).toBe(1);
    expect(funnelReach({ status: "agendado", interest_level: "morno" }, [], 33)).toBe(2);
    expect(funnelReach({ status: "discovery", interest_level: "frio" }, [{ stage: "qualificado" }], 0)).toBe(2);
    expect(funnelReach({ status: "discovery", interest_level: "frio" }, [{ stage: "lead" }], 0)).toBe(0);
    expect(funnelReach({ status: "fechado", interest_level: "frio" }, [], 0)).toBe(3);
  });
});

describe("funil e conversão", () => {
  it("funil é cumulativo e conversão usa só contas decididas", () => {
    const s = buildDemoSnapshot(TZ, new Date("2026-10-29T18:00:00Z"));
    const acc = [...enrichAll(s).values()];
    const f = funnel(acc);
    expect(f[0].count).toBe(acc.length);
    expect(f[0].count).toBeGreaterThanOrEqual(f[1].count);
    expect(f[1].count).toBeGreaterThanOrEqual(f[2].count);
    expect(f[3].count).toBe(acc.filter((a) => a.funnel_stage === "cliente").length);
    const byPersona = conversionBy(acc, (a) => a.persona);
    const total = byPersona.reduce((t, r) => t + r.won + r.lost + r.open, 0);
    expect(total).toBe(acc.length);
  });
});
