// Geografia das rotas, em TS puro (testável). Sem custo: geocodificação via OpenStreetMap (Nominatim)
// e distância por ruas via OSRM público, chamados do navegador; se falharem, cai para linha reta
// com fator de correção — e a tela mostra qual fonte foi usada.
import type { Account } from "./types";

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Centro aproximado dos bairros (Zona Oeste do Rio e vizinhos). Usado só quando a conta não tem
 * coordenada própria; o app marca a precisão como "bairro" para o vendedor saber que é aproximado.
 */
export const BAIRRO_CENTROIDS: Record<string, LatLng> = {
  "campo grande": { lat: -22.9035, lng: -43.5592 },
  "santa cruz": { lat: -22.9195, lng: -43.6845 },
  "paciencia": { lat: -22.888, lng: -43.636 },
  "jesuitas": { lat: -22.887, lng: -43.664 },
  "jardim palmares": { lat: -22.88, lng: -43.615 },
  "inhoaiba": { lat: -22.9, lng: -43.59 },
  "manguariba": { lat: -22.895, lng: -43.65 },
  "conjunto campinho": { lat: -22.889, lng: -43.583 },
  "conjunto novo campinho": { lat: -22.889, lng: -43.583 },
  "palmares": { lat: -22.88, lng: -43.615 },
  "cosmos": { lat: -22.91, lng: -43.62 },
  "sepetiba": { lat: -22.97, lng: -43.7 },
  "guaratiba": { lat: -22.99, lng: -43.6 },
  "pedra de guaratiba": { lat: -23.0, lng: -43.64 },
  "bangu": { lat: -22.8752, lng: -43.4652 },
  "senador camara": { lat: -22.875, lng: -43.495 },
  "santissimo": { lat: -22.88, lng: -43.52 },
  "senador vasconcelos": { lat: -22.89, lng: -43.53 },
  "realengo": { lat: -22.88, lng: -43.43 },
  "padre miguel": { lat: -22.875, lng: -43.45 },
  "posse": { lat: -22.905, lng: -43.545 },
  "recreio": { lat: -23.02, lng: -43.46 },
  "recreio dos bandeirantes": { lat: -23.02, lng: -43.46 },
  "barra da tijuca": { lat: -23.0, lng: -43.36 },
  "barra": { lat: -23.0, lng: -43.36 },
  "itaguai": { lat: -22.8636, lng: -43.7753 },
};

export const normalizeKey = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type PointSource = "conta" | "bairro";
export interface Located extends LatLng {
  source: PointSource;
}

/** Coordenada da conta (própria) ou centro do bairro (aproximada). null = sem como localizar. */
export function locate(a: Pick<Account, "latitude" | "longitude" | "neighborhood">): Located | null {
  if (a.latitude != null && a.longitude != null) return { lat: a.latitude, lng: a.longitude, source: "conta" };
  const c = a.neighborhood ? BAIRRO_CENTROIDS[normalizeKey(a.neighborhood)] : undefined;
  return c ? { ...c, source: "bairro" } : null;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Fator ruas/linha reta em área urbana. Estudos de "circuity" em cidades ficam tipicamente entre 1,2 e 1,4;
 * usamos 1,3 e deixamos o vendedor ajustar na tela.
 */
export const DEFAULT_CIRCUITY = 1.3;

function pathKm(order: number[], pts: LatLng[], start: LatLng | null): number {
  let km = 0;
  let prev = start;
  for (const i of order) {
    if (prev) km += haversineKm(prev, pts[i]);
    prev = pts[i];
  }
  return km;
}

/**
 * Ordem que minimiza a distância: vizinho mais próximo (a partir do início) + melhoria 2-opt.
 * Para o tamanho real de um dia de campo (até ~15 paradas) isso fica a poucos % do ótimo.
 */
export function optimizeOrder(pts: LatLng[], start: LatLng | null = null): number[] {
  const n = pts.length;
  if (n <= 1) return pts.map((_, i) => i);
  const left = new Set(pts.map((_, i) => i));
  const order: number[] = [];
  let cur: LatLng | null = start;
  if (!cur) {
    // sem ponto de partida: começa pela parada mais "na ponta" (a mais distante do centro)
    const c = { lat: pts.reduce((s, p) => s + p.lat, 0) / n, lng: pts.reduce((s, p) => s + p.lng, 0) / n };
    let far = 0;
    for (let i = 1; i < n; i++) if (haversineKm(c, pts[i]) > haversineKm(c, pts[far])) far = i;
    order.push(far);
    left.delete(far);
    cur = pts[far];
  }
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    for (const i of left) {
      const d = haversineKm(cur!, pts[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    order.push(best);
    left.delete(best);
    cur = pts[best];
  }
  // 2-opt
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const cand = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        if (pathKm(cand, pts, start) + 1e-9 < pathKm(order, pts, start)) {
          order.splice(0, n, ...cand);
          improved = true;
        }
      }
    }
  }
  return order;
}

export interface LegEstimate {
  km: number;
  minutes: number;
}

/** Distância e tempo por trecho, em linha reta corrigida (sem internet). */
export function straightLegs(pts: LatLng[], start: LatLng | null, circuity: number, speedKmh: number): LegEstimate[] {
  const legs: LegEstimate[] = [];
  let prev = start;
  for (const p of pts) {
    const km = prev ? haversineKm(prev, p) * circuity : 0;
    legs.push({ km, minutes: (km / speedKmh) * 60 });
    prev = p;
  }
  return legs;
}

/** Trechos por ruas via OSRM público. Retorna null se o serviço não responder (o app cai para linha reta). */
export async function streetLegs(pts: LatLng[], start: LatLng | null, signal?: AbortSignal): Promise<LegEstimate[] | null> {
  const all = start ? [start, ...pts] : pts;
  if (all.length < 2) return pts.map(() => ({ km: 0, minutes: 0 }));
  const coords = all.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`, { signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { code: string; routes?: { legs: { distance: number; duration: number }[] }[] };
    const legs = j.code === "Ok" ? j.routes?.[0]?.legs : undefined;
    if (!legs) return null;
    const out = legs.map((l) => ({ km: l.distance / 1000, minutes: l.duration / 60 }));
    return start ? out : [{ km: 0, minutes: 0 }, ...out];
  } catch {
    return null;
  }
}

export interface GeocodeHit extends LatLng {
  precision: "endereco" | "rua";
  via: "cep" | "osm";
}

/** CEP (8 dígitos) escrito no endereço, se houver. */
export function extractCep(address: string | null | undefined): string | null {
  const m = address?.match(/\b(\d{5})-?(\d{3})\b/);
  return m ? m[1] + m[2] : null;
}

/**
 * Endereço limpo para o OpenStreetMap: "Av. Isabel, 331 - Santa Cruz, RJ, 23515-161" vira "Av. Isabel, 331".
 * Tira CEP, UF, bairro repetido e complemento de loja/sala, que fazem a busca falhar.
 */
export function streetPart(address: string): string {
  return address
    .split(" - ")[0]
    .replace(/\b\d{5}-?\d{3}\b/g, "")
    .replace(/\b(lj|loja|sala|sl|apto?|bloco|bl|fundos|casa)\b\.?\s*[\w-]*/gi, "")
    .replace(/\s+,/g, ",")
    .replace(/[,\s]+$/, "")
    .trim();
}

/** Ponto plausível: perto do bairro informado (8 km) ou, sem bairro conhecido, dentro do município do Rio. */
function plausible(a: Pick<Account, "neighborhood">, p: LatLng): boolean {
  const c = a.neighborhood ? BAIRRO_CENTROIDS[normalizeKey(a.neighborhood)] : undefined;
  if (c) return haversineKm(c, p) <= 8;
  return p.lat < -22.7 && p.lat > -23.1 && p.lng < -43.1 && p.lng > -43.8;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const r = await fetch(url, { signal, headers: { Accept: "application/json" } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Coordenada do CEP (AwesomeAPI e BrasilAPI, gratuitas). No Rio, um CEP costuma ser um trecho de rua. */
export async function geocodeCep(cep: string, signal?: AbortSignal): Promise<LatLng | null> {
  const aw = await getJson<{ lat?: string; lng?: string }>(`https://cep.awesomeapi.com.br/json/${cep}`, signal);
  if (aw?.lat && aw?.lng && Number(aw.lat) && Number(aw.lng)) return { lat: Number(aw.lat), lng: Number(aw.lng) };
  const br = await getJson<{ location?: { coordinates?: { latitude?: string; longitude?: string } } }>(
    `https://brasilapi.com.br/api/cep/v2/${cep}`, signal,
  );
  const c = br?.location?.coordinates;
  if (c?.latitude && c?.longitude && Number(c.latitude) && Number(c.longitude)) return { lat: Number(c.latitude), lng: Number(c.longitude) };
  return null;
}

/**
 * Geocodifica um endereço: primeiro o número da rua no OpenStreetMap (mais preciso), depois o CEP.
 * Nominatim aceita no máximo 1 pedido por segundo: quem chama em lote espera entre as contas.
 */
export async function geocode(a: Pick<Account, "address" | "neighborhood" | "city">, signal?: AbortSignal): Promise<GeocodeHit | null> {
  if (!a.address?.trim()) return null;
  const street = streetPart(a.address);
  if (street) {
    const params = new URLSearchParams({
      format: "jsonv2", limit: "1", countrycodes: "br", "accept-language": "pt-BR",
      street, city: a.city || "Rio de Janeiro", state: "Rio de Janeiro", country: "Brasil",
    });
    const j = await getJson<{ lat: string; lon: string; addresstype?: string; type?: string }[]>(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`, signal,
    );
    const hit = j?.[0];
    if (hit) {
      const p = { lat: Number(hit.lat), lng: Number(hit.lon) };
      if (plausible(a, p)) {
        const precise = /^(building|house|amenity|restaurant|fast_food|cafe|bar|pub|shop|place)$/.test(hit.addresstype ?? hit.type ?? "");
        return { ...p, precision: precise ? "endereco" : "rua", via: "osm" };
      }
    }
  }
  const cep = extractCep(a.address);
  if (cep) {
    const p = await geocodeCep(cep, signal);
    if (p && plausible(a, p)) return { ...p, precision: "rua", via: "cep" };
  }
  return null;
}

/** Quantas paradas caem exatamente no mesmo ponto (ex.: todas no centro do bairro). Distância entre elas sai 0. */
export function stackedPoints(pts: LatLng[]): number {
  const seen = new Map<string, number>();
  for (const p of pts) {
    const k = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  let n = 0;
  for (const c of seen.values()) if (c > 1) n += c;
  return n;
}

/** Link do Google Maps com a rota inteira (o app do celular abre direto na navegação). */
export function googleMapsRoute(stops: (LatLng | string)[], origin?: LatLng | null): string | null {
  if (!stops.length) return null;
  const fmt = (p: LatLng | string) => (typeof p === "string" ? p : `${p.lat},${p.lng}`);
  const dest = stops[stops.length - 1];
  const way = stops.slice(0, -1);
  const params = new URLSearchParams({ api: "1", destination: fmt(dest), travelmode: "driving" });
  if (origin) params.set("origin", fmt(origin));
  if (way.length) params.set("waypoints", way.map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Destino para o Maps: coordenada própria, senão endereço em texto, senão centro do bairro. */
export function mapsStop(a: Pick<Account, "latitude" | "longitude" | "address" | "neighborhood" | "city" | "name">): LatLng | string | null {
  if (a.latitude != null && a.longitude != null) return { lat: a.latitude, lng: a.longitude };
  if (a.address?.trim()) return [a.address, a.neighborhood, a.city ?? "Rio de Janeiro"].filter(Boolean).join(", ");
  const c = locate({ latitude: null, longitude: null, neighborhood: a.neighborhood });
  return c ? { lat: c.lat, lng: c.lng } : null;
}

/** Horários sugeridos: chegada = saída anterior + deslocamento (arredondado para 5 min). */
export function planTimes(startIso: string, legs: LegEstimate[], durations: number[]): string[] {
  let t = new Date(startIso).getTime();
  const out: string[] = [];
  legs.forEach((l, i) => {
    t += l.minutes * 60_000;
    t = Math.ceil(t / 300_000) * 300_000;
    out.push(new Date(t).toISOString());
    t += (durations[i] ?? 45) * 60_000;
  });
  return out;
}

export const sumLegs = (legs: LegEstimate[]) => legs.reduce((s, l) => ({ km: s.km + l.km, minutes: s.minutes + l.minutes }), { km: 0, minutes: 0 });
