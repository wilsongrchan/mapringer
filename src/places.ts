import type { LngLat } from "./geo";
import { LANG, PLACE_LANG } from "./i18n";
import { seaName } from "./seas";

/**
 * Reverse-geocode a point to "Town, Country" using OpenStreetMap Nominatim.
 * Nominatim's usage policy allows at most 1 request per second, so requests
 * are queued and results cached. Fine for a prototype; a production launch
 * should use a hosted geocoder or a bundled places dataset instead.
 */
const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
const GAP_MS = 1100;

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  county?: string;
  state_district?: string;
  state?: string;
  region?: string;
  country?: string;
}

function format(a: NominatimAddress | undefined): string {
  if (!a) return "";
  const local = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality ?? a.county ?? a.state_district;
  const parts = [local, local ? undefined : (a.state ?? a.region), a.country].filter(Boolean);
  // Chinese addresses run from big to small: 英國 牛津
  return LANG === "zh" ? parts.reverse().join(" ") : parts.join(", ");
}

async function lookup(p: LngLat): Promise<string> {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=${encodeURIComponent(PLACE_LANG)}` +
    `&lat=${p.lat.toFixed(5)}&lon=${p.lng.toFixed(5)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = (await res.json()) as { address?: NominatimAddress; error?: string };
  // nothing on land here: name the sea or ocean instead ("South China Sea", 南太平洋…)
  return format(data.address) || seaName(p, LANG);
}

export function placeName(p: LngLat): Promise<string> {
  const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = queue.then(() => lookup(p));
    queue = hit.catch(() => {}).then(() => new Promise((r) => setTimeout(r, GAP_MS)));
    hit.catch(() => cache.delete(key));
    cache.set(key, hit);
  }
  return hit;
}

export const coords = (p: LngLat) =>
  `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? "N" : "S"}, ${Math.abs(p.lng).toFixed(2)}°${p.lng >= 0 ? "E" : "W"}`;
