import { describe, expect, it } from "vitest";
import { extractCep, googleMapsRoute, haversineKm, locate, optimizeOrder, planTimes, stackedPoints, straightLegs, streetPart } from "./geo";

describe("geo", () => {
  it("haversine Campo Grande → Santa Cruz ≈ 13 km em linha reta", () => {
    const d = haversineKm({ lat: -22.9035, lng: -43.5592 }, { lat: -22.9195, lng: -43.6845 });
    expect(d).toBeGreaterThan(12);
    expect(d).toBeLessThan(14);
  });

  it("localiza por coordenada própria ou pelo bairro (sem acento/maiúscula)", () => {
    expect(locate({ latitude: 1, longitude: 2, neighborhood: null })).toEqual({ lat: 1, lng: 2, source: "conta" });
    expect(locate({ latitude: null, longitude: null, neighborhood: "PACIÊNCIA" })?.source).toBe("bairro");
    expect(locate({ latitude: null, longitude: null, neighborhood: "Bairro Inexistente" })).toBeNull();
  });

  it("otimização não cruza a cidade de volta (zigue-zague vira linha)", () => {
    // pontos em linha leste→oeste, fora de ordem
    const pts = [0, 4, 1, 3, 2].map((x) => ({ lat: -22.9, lng: -43.5 - x * 0.05 }));
    const order = optimizeOrder(pts, { lat: -22.9, lng: -43.49 });
    expect(order.map((i) => Math.round((-43.5 - pts[i].lng) / 0.05))).toEqual([0, 1, 2, 3, 4]);
    const bad = straightLegs(pts, null, 1, 30).reduce((s, l) => s + l.km, 0);
    const good = straightLegs(order.map((i) => pts[i]), null, 1, 30).reduce((s, l) => s + l.km, 0);
    expect(good).toBeLessThan(bad);
  });

  it("horários: chegada = saída anterior + deslocamento, arredondado a 5 min", () => {
    const t = planTimes("2026-10-29T12:00:00Z", [{ km: 0, minutes: 0 }, { km: 5, minutes: 12 }], [45, 30]);
    expect(t).toEqual(["2026-10-29T12:00:00.000Z", "2026-10-29T13:00:00.000Z"]);
  });

  it("link do Google Maps com paradas intermediárias", () => {
    const url = googleMapsRoute([{ lat: 1, lng: 2 }, "Rua X, 10", { lat: 3, lng: 4 }])!;
    const q = new URL(url).searchParams;
    expect(q.get("destination")).toBe("3,4");
    expect(q.get("waypoints")).toBe("1,2|Rua X, 10");
  });
});

describe("limpeza de endereço para geocodificar (v2)", () => {
  it("separa rua e número, tira bairro, UF, CEP e complemento", () => {
    expect(streetPart("Av. Isabel, 331 - Santa Cruz, RJ, 23515-161")).toBe("Av. Isabel, 331");
    expect(streetPart("R. Dom Pedro I, 66 Lj C - Santa Cruz, RJ, 23510-010")).toBe("R. Dom Pedro I, 66");
    expect(streetPart("Av. Padre Guilherme Decaminada - Santa Cruz, RJ")).toBe("Av. Padre Guilherme Decaminada");
    expect(extractCep("Praca Areia Branca, 8 - Santa Cruz, RJ, 23550-340")).toBe("23550340");
    expect(extractCep("Av. Padre Guilherme Decaminada - Santa Cruz, RJ")).toBeNull();
  });
  it("detecta paradas empilhadas no mesmo ponto", () => {
    const c = { lat: -22.9195, lng: -43.6845 };
    expect(stackedPoints([c, c, c, { lat: -22.9, lng: -43.56 }])).toBe(3);
    expect(stackedPoints([c, { lat: -22.9, lng: -43.56 }])).toBe(0);
  });
  it("bairros da base real têm centro (inclui Conjunto Novo Campinho)", () => {
    for (const b of ["Campo Grande", "Santa Cruz", "Jesuítas", "Paciência", "Conjunto Campinho", "Manguariba", "Jardim Palmares", "Conjunto Novo Campinho", "Inhoaíba"])
      expect(locate({ latitude: null, longitude: null, neighborhood: b })).not.toBeNull();
  });
});
