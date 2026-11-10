import type { LngLat } from "./geo";

/**
 * Names for points at sea, where the place-name lookup finds nothing: the
 * sea or strait (rough boxes, smaller ones first so they win over the bigger
 * seas around them), else the ocean. Approximate, but far better than
 * "open water".
 */
interface Sea {
  en: string;
  zh: string;
  /** west, south, east, north (west > east wraps across the 180° meridian) */
  box: [number, number, number, number];
}

const SEAS: Sea[] = [
  { en: "English Channel", zh: "英吉利海峽", box: [-5.7, 48.6, 1.8, 51.1] },
  { en: "Strait of Malacca", zh: "馬六甲海峽", box: [95, 1, 104, 6.5] },
  { en: "Gulf of Thailand", zh: "泰國灣", box: [99, 6, 105, 13.5] },
  { en: "Persian Gulf", zh: "波斯灣", box: [47.5, 23.5, 56.5, 30.5] },
  { en: "Red Sea", zh: "紅海", box: [32, 12.5, 43.5, 30] },
  { en: "Black Sea", zh: "黑海", box: [27.4, 40.9, 41.8, 47] },
  { en: "Caspian Sea", zh: "裏海", box: [46.5, 36.5, 54.8, 47.2] },
  { en: "Baltic Sea", zh: "波羅的海", box: [9.5, 53.5, 30, 66] },
  { en: "North Sea", zh: "北海", box: [-4, 51, 9, 61] },
  { en: "Mediterranean Sea", zh: "地中海", box: [-5.6, 30, 36.5, 46] },
  { en: "Yellow Sea", zh: "黃海", box: [117, 33, 127, 41] },
  { en: "East China Sea", zh: "東海", box: [117, 23, 131, 33] },
  { en: "Sea of Japan", zh: "日本海", box: [127, 33, 142, 52] },
  { en: "Sea of Okhotsk", zh: "鄂霍次克海", box: [135, 43, 163, 63] },
  { en: "Java Sea", zh: "爪哇海", box: [105, -8, 120, -3] },
  { en: "Andaman Sea", zh: "安達曼海", box: [92, 5, 99, 16] },
  { en: "South China Sea", zh: "南中國海", box: [99, 0, 121, 23] },
  { en: "Philippine Sea", zh: "菲律賓海", box: [121, 5, 145, 35] },
  { en: "Bay of Bengal", zh: "孟加拉灣", box: [78, 5, 95, 23] },
  { en: "Arabian Sea", zh: "阿拉伯海", box: [50, 5, 77, 25] },
  { en: "Mozambique Channel", zh: "莫桑比克海峽", box: [34, -25, 49, -11] },
  { en: "Coral Sea", zh: "珊瑚海", box: [145, -30, 165, -8] },
  { en: "Tasman Sea", zh: "塔斯曼海", box: [147, -48, 175, -28] },
  { en: "Gulf of Mexico", zh: "墨西哥灣", box: [-98, 18, -80.5, 31] },
  { en: "Caribbean Sea", zh: "加勒比海", box: [-88, 9, -60, 22.5] },
  { en: "Hudson Bay", zh: "哈德遜灣", box: [-95, 51, -76, 64] },
  { en: "Gulf of Alaska", zh: "阿拉斯加灣", box: [-160, 50, -130, 61] },
  { en: "Bering Sea", zh: "白令海", box: [162, 51, -157, 66] },
  { en: "Norwegian Sea", zh: "挪威海", box: [-5, 61, 15, 72] },
  { en: "Barents Sea", zh: "巴倫支海", box: [15, 68, 60, 80] },
];

const inBox = (p: LngLat, [w, s, e, n]: Sea["box"]) =>
  p.lat >= s && p.lat <= n && (w <= e ? p.lng >= w && p.lng <= e : p.lng >= w || p.lng <= e);

/** Which ocean a point is in (rough boundaries along the continents). */
function ocean(p: LngLat): { en: string; zh: string } {
  const { lat, lng } = p;
  if (lat > 66) return { en: "Arctic Ocean", zh: "北冰洋" };
  if (lat < -60) return { en: "Southern Ocean", zh: "南冰洋" };
  // Indian Ocean: south of Asia, between Africa and Australia
  if ((lng >= 20 && lng < 100 && lat < 25) || (lng >= 100 && lng < 146 && lat < -8)) return { en: "Indian Ocean", zh: "印度洋" };
  // Atlantic: between the Americas and Europe / Africa
  const atlanticWest = lat > 10 ? -98 : lat > 0 ? -80 : -70;
  if (lng >= atlanticWest && lng < 20) return lat >= 0 ? { en: "North Atlantic Ocean", zh: "北大西洋" } : { en: "South Atlantic Ocean", zh: "南大西洋" };
  return lat >= 0 ? { en: "North Pacific Ocean", zh: "北太平洋" } : { en: "South Pacific Ocean", zh: "南太平洋" };
}

/** The sea or ocean name at a point, in the given language. */
export function seaName(p: LngLat, lang: "en" | "zh"): string {
  const lng = ((((p.lng + 180) % 360) + 360) % 360) - 180;
  const at = { lat: p.lat, lng };
  const sea = SEAS.find((s) => inBox(at, s.box)) ?? ocean(at);
  return sea[lang];
}
