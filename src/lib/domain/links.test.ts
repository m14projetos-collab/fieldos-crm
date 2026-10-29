import { describe, expect, it } from "vitest";
import { autoAdvance, buildIcs, composeLink, fillVars, googleCalendarLink, outlookCalendarLink, researchLinks, suggestedEmailId } from "./links";

const acc = { name: "Bar do Zé", decision_maker_name: "José Silva", neighborhood: "Campo Grande", current_system: "Anota AI", city: "Rio de Janeiro", instagram_url: null, website_url: null };

describe("composeLink", () => {
  it("monta Gmail, Outlook e mailto com acentos e quebras codificados", () => {
    const m = { to: "ze@bar.com", subject: "Proposta ção", body: "a\nb" };
    expect(composeLink("gmail", m)).toBe("https://mail.google.com/mail/?view=cm&fs=1&to=ze%40bar.com&su=Proposta%20%C3%A7%C3%A3o&body=a%0Ab");
    expect(composeLink("outlook", m)).toContain("https://outlook.live.com/mail/0/deeplink/compose?to=ze%40bar.com&subject=");
    expect(composeLink("outlook365", m)).toContain("https://outlook.office.com/mail/deeplink/compose?");
    expect(composeLink("mailto", m)).toBe("mailto:ze%40bar.com?subject=Proposta%20%C3%A7%C3%A3o&body=a%0Ab");
  });
  it("sem destinatário não deixa to= vazio no Gmail", () => {
    expect(composeLink("gmail", { subject: "x", body: "y" })).not.toContain("to=");
  });
});

describe("autoAdvance", () => {
  it("só avança, nunca volta e não mexe em fechado/perdido", () => {
    expect(autoAdvance("demo_realizada", "proposta_enviada")).toBe("proposta_enviada");
    expect(autoAdvance("negociacao", "proposta_enviada")).toBeNull();
    expect(autoAdvance("lead_importado", "primeiro_contato")).toBe("primeiro_contato");
    expect(autoAdvance("perdido", "primeiro_contato")).toBeNull();
    expect(autoAdvance("fechado", "proposta_enviada")).toBeNull();
    expect(autoAdvance("discovery", undefined)).toBeNull();
  });
  it("modelo sugerido por etapa", () => {
    expect(suggestedEmailId("demo_realizada")).toBe("e-proposta");
    expect(suggestedEmailId("fechado")).toBe("e-boas-vindas");
    expect(suggestedEmailId("lead_importado")).toBe("e-pos-visita");
  });
});

describe("fillVars", () => {
  it("preenche variáveis e troca link vazio por texto neutro", () => {
    const t = fillVars("Olá {nome}, {restaurante} ({bairro}). {link_agenda} {vendedor}/{empresa}", acc, { seller: "Michel", company: "Takeat" });
    expect(t).toBe("Olá José, Bar do Zé (Campo Grande). (me responda com o melhor dia e horário) Michel/Takeat");
    expect(fillVars("{link_proposta}", acc, { seller: "", company: "", links: { proposal: "https://x.co/p" } })).toBe("https://x.co/p");
  });
});

describe("agenda", () => {
  const ev = { uid: "v1", title: "Visita: Bar do Zé, Campo; Grande", start: new Date("2026-10-30T12:00:00Z"), end: new Date("2026-10-30T12:30:00Z"), details: "linha1\nlinha2", location: "Rua A, 10" };
  it("Google Agenda e Outlook com datas corretas", () => {
    expect(googleCalendarLink(ev)).toContain("dates=20261030T120000Z%2F20261030T123000Z");
    const o = outlookCalendarLink(ev);
    expect(o.startsWith("https://outlook.live.com/calendar/0/deeplink/compose?")).toBe(true);
    expect(o).toContain("startdt=2026-10-30T12%3A00%3A00.000Z");
  });
  it(".ics válido: CRLF, escape, lembrete, linhas ≤ 75 octetos", () => {
    const ics = buildIcs([{ ...ev, details: "x".repeat(200) + "ção" }], "Teste", new Date("2026-10-29T00:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("SUMMARY:Visita: Bar do Zé\\, Campo\\; Grande");
    expect(ics).toContain("DTSTART:20261030T120000Z");
    expect(ics).toContain("TRIGGER:-PT30M");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("researchLinks", () => {
  it("usa Instagram do cadastro e pasta do Drive configurada", () => {
    const l = researchLinks({ ...acc, instagram_url: "@barze" }, "https://drive.google.com/drive/folders/abc");
    expect(l.find((x) => x.id === "instagram")?.href).toBe("https://www.instagram.com/barze");
    expect(l.find((x) => x.id === "drive")?.href).toBe("https://drive.google.com/drive/folders/abc");
    expect(l.find((x) => x.id === "reviews")?.href).toContain("google.com/maps/search/?api=1&query=Bar%20do%20Z%C3%A9");
  });
});
