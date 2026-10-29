import { describe, expect, it } from "vitest";
import { fillTemplate, isSafeWebhookUrl, navLink, parseCsv, planImport, toCsv, waApiRequest, waDigits } from "./integrations";
import { buildDemoSnapshot } from "../data/demo-seed";

const acc = { name: "Point Mix Gourmet", decision_maker_name: "Carlos Souza", neighborhood: "Santa Cruz", current_system: "Anota AI" };

describe("modelos de WhatsApp", () => {
  it("preenche as 4 variáveis e limpa as vazias", () => {
    expect(fillTemplate("Olá {nome}, o {restaurante} em {bairro} usa {sistema}?", acc)).toBe("Olá Carlos, o Point Mix Gourmet em Santa Cruz usa Anota AI?");
    expect(fillTemplate("Olá {nome}, tudo bem?", { ...acc, decision_maker_name: null })).toBe("Olá, tudo bem?");
    expect(fillTemplate("usa {sistema}", { ...acc, current_system: "A validar" })).toBe("usa o sistema atual");
  });
  it("normaliza o número para 55 + DDD", () => {
    expect(waDigits("(21) 99762-9741")).toBe("5521997629741");
    expect(waDigits("+55 21 3333-4444")).toBe("552133334444");
    expect(waDigits("123")).toBeNull();
  });
  it("monta Evolution e Z-API; modo link não chama API", () => {
    const ev = waApiRequest({ mode: "evolution", base_url: "https://evo.exemplo.com/", instance: "takeat", token: "k", templates: [] }, "5521997629741", "oi");
    expect(ev).toEqual({ url: "https://evo.exemplo.com/message/sendText/takeat", headers: { "Content-Type": "application/json", apikey: "k" }, body: { number: "5521997629741", text: "oi" } });
    const z = waApiRequest({ mode: "zapi", instance: "I1", token: "T1", client_token: "C", templates: [] }, "5521", "oi");
    expect(z?.url).toBe("https://api.z-api.io/instances/I1/token/T1/send-text");
    expect(z?.headers["Client-Token"]).toBe("C");
    expect(waApiRequest({ mode: "link", templates: [] }, "1", "x")).toBeNull();
  });
});

describe("webhook e navegação", () => {
  it("só aceita https público", () => {
    expect(isSafeWebhookUrl("https://hook.us1.make.com/abc")).toBe(true);
    expect(isSafeWebhookUrl("http://hook.make.com/abc")).toBe(false);
    expect(isSafeWebhookUrl("https://localhost/x")).toBe(false);
    expect(isSafeWebhookUrl("https://192.168.0.10/x")).toBe(false);
  });
  it("Waze e Google Maps com coordenada ou endereço", () => {
    expect(navLink("waze", { latitude: -22.9, longitude: -43.6, address: null, neighborhood: null, city: null })).toBe("https://waze.com/ul?ll=-22.9,-43.6&navigate=yes");
    expect(navLink("google", { latitude: null, longitude: null, address: "Av. Isabel, 331", neighborhood: "Santa Cruz", city: null })).toContain("destination=Av.%20Isabel");
    expect(navLink("waze", { latitude: null, longitude: null, address: null, neighborhood: null, city: null })).toBeNull();
  });
});

describe("CSV", () => {
  it("lê aspas, ponto e vírgula do Excel e quebra de linha", () => {
    expect(parseCsv('﻿name;neighborhood\n"Bar ""do"" Zé";Bangu\r\n"Linha\nquebrada";X\n')).toEqual([["name", "neighborhood"], ['Bar "do" Zé', "Bangu"], ["Linha\nquebrada", "X"]]);
  });
  it("exporta e reimporta sem mudar nada (idempotente)", () => {
    const s = buildDemoSnapshot("America/Sao_Paulo");
    const plan = planImport(parseCsv(toCsv(s.accounts)), s.accounts);
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toEqual([]);
    expect(plan.unchanged).toBe(s.accounts.length);
  });
  it("atualiza por id ou nome+bairro, cria novos, ignora inválidos e não apaga com célula vazia", () => {
    const s = buildDemoSnapshot("America/Sao_Paulo");
    const a = s.accounts[0];
    const rows = parseCsv(
      `id,name,neighborhood,priority,current_system,phone\n${a.id},,,Média,Saipos,\n,${a.name},${a.neighborhood ?? ""},alta,,\n,Novo Bar,Bangu,baixa,,21999990000\n,Outro,Bangu,urgente,,\nnao-existe,X,Y,,,\n`,
    );
    const p = planImport(rows, s.accounts);
    expect(p.updates[0]).toMatchObject({ id: a.id, patch: { priority: "media" } });
    expect(p.updates[0].patch).not.toHaveProperty("phone");
    expect(p.creates.map((c) => c.data.name)).toEqual(["Novo Bar", "Outro"]);
    expect(p.creates[0].data).toMatchObject({ priority: "baixa", phone: "21999990000" });
    expect(p.skipped.map((x) => x.row)).toEqual([5, 6]);
  });
});
