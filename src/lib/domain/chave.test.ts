import { describe, expect, it } from "vitest";
import { AUDIT_ITEMS, buildAuditPrompt, icpResult, metricAlert, scoreAudit } from "./chave";
import type { Account } from "./types";

describe("ICP", () => {
  it("3 ou mais 'não' = nutrição; tudo respondido sem isso = pipeline", () => {
    expect(icpResult({ dor: false, volume: false, decisor: false }).verdict).toBe("nutricao");
    expect(icpResult({ dor: true, volume: true }).verdict).toBe("incompleto");
    expect(icpResult({ dor: true, volume: true, decisor: true, concorrente: false, timing: false }).verdict).toBe("pipeline");
  });
  it("prioridade calibrada: alta exige dor+volume+decisor+timing", () => {
    expect(icpResult({ dor: true, volume: true, decisor: true, timing: true }).priority).toBe("alta");
    expect(icpResult({ dor: true, volume: true, decisor: false }).priority).toBe("media");
    expect(icpResult({ dor: false }).priority).toBe("baixa");
    expect(icpResult({}).priority).toBeNull();
  });
});

describe("auditoria CHAVE", () => {
  it("nota por etapa vem do checklist e aponta a primeira etapa pulada", () => {
    const r = scoreAudit({ abertura: true, tres_perguntas: true, numero_dor: false, beneficio_resposta: true, como: true, isolei: true, indicacao: false }, "socio_financeiro");
    expect(r.scores).toEqual({ conexao: 10, hipotese: 10, ancoragem: 5, virada: 10, extensao: 0 });
    expect(r.total).toBe(7.1);
    expect(r.biggestFix).toBe(AUDIT_ITEMS.find((i) => i.id === "numero_dor")!.fix);
    const all = scoreAudit(Object.fromEntries(AUDIT_ITEMS.map((i) => [i.id, true])), null);
    expect(all.total).toBe(10);
    expect(all.biggestFix).toBeNull();
  });
  it("prompt leva o contexto do CRM e o texto colado", () => {
    const acc = { name: "Pizzaria X", segment: "Pizzaria", neighborhood: "Bangu", current_system: "Saipos", decision_maker_name: null, estimated_monthly_pain_brl: 1800 } as Account;
    const p = buildAuditPrompt(acc, null, [], "Ele disse que perde pedido no pico");
    expect(p).toContain("Pizzaria X (Pizzaria), Bangu");
    expect(p).toContain("R$ 1800/mês");
    expect(p).toContain("Ele disse que perde pedido no pico");
  });
});

describe("termômetro", () => {
  it("não alerta com amostra pequena", () => {
    expect(metricAlert({ id: "x", stage: "conexao", label: "", value: 0.1, base: 3, threshold: 0.4, direction: "min", how: "" })).toBe(false);
    expect(metricAlert({ id: "x", stage: "conexao", label: "", value: 0.1, base: 30, threshold: 0.4, direction: "min", how: "" })).toBe(true);
    expect(metricAlert({ id: "x", stage: "ancoragem", label: "", value: 0.6, base: 30, threshold: 0.5, direction: "max", how: "" })).toBe(true);
  });
});
