/**
 * UI text in English and Traditional Chinese (圈地家).
 *
 * Language: ?lang=zh / ?lang=en, else the saved choice, else the browser's
 * language (any zh-* → Traditional Chinese). Static text in index.html is
 * tagged with data-i18n (text) or data-i18n-html (markup) and filled in by
 * applyStaticText().
 */
import { formatPeople } from "./numbers";

export type Lang = "en" | "zh";

function detect(): Lang {
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "en" || q === "zh") return q;
  try {
    const saved = localStorage.getItem("mapringer:lang");
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.languages?.some((l) => l.toLowerCase().startsWith("zh")) ? "zh" : "en";
}

export const LANG: Lang = detect();

export function switchLanguage(): void {
  const next: Lang = LANG === "en" ? "zh" : "en";
  try {
    localStorage.setItem("mapringer:lang", next);
  } catch {
    /* storage unavailable */
  }
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  location.href = url.toString();
}

type Vars = Record<string, string | number>;
type Entry = string | ((v: Vars) => string);

const en = {
  appName: "MapRinger",
  description: "A daily map game: drop the ring anywhere on Earth to fit the target population inside it.",
  langButton: "中",
  langButtonLabel: "切換到中文",
  helpLabel: "How to play",

  todaysRing: "Today's ring",
  practiceRing: "Practice ring",
  twistGiant: "Twist · a giant, empty ring",
  twistTiny: "Twist · a tiny, packed ring",
  practiceTag: "· practice",
  testTag: " · test",
  challengeLine: (v: Vars) =>
    `Fit <strong>${v.target}</strong> people in <strong>${v.article} ${v.radius} km ring</strong>`,

  ringLabel: (v: Vars) => `Ring ${v.n} of 3 · ${v.map} map · ${v.max} pts`,
  playHint: "Pan and zoom the map to move the ring. One try per ring.",
  testHint: "Test mode: unlimited attempts and days, nothing is saved.",
  lockIn: "Lock in ring",
  lockInShort: "Lock in",
  counting: "Counting people…",
  diffEasy: "Easy",
  diffStandard: "Standard",
  diffHard: "Hard",
  blurbEasy: "Satellite with labels and borders",
  blurbStandard: "Light map with labels, no roads",
  blurbHard: "Land, lakes and rivers only",

  yourRing: "Your ring",
  target: "Target",
  shareResult: "Share result",
  nextRingIn: "Next ring in",
  tryAgain: "Try again",
  newPuzzle: "New puzzle",
  showResults: "Show results",
  hideResults: "Hide results",
  points: (v: Vars) => `<strong>${v.points}</strong> / ${v.max} pts`,
  summary: (v: Vars) => `<strong>${v.pop}</strong> people · ${v.emoji} <strong>${v.points}</strong> / ${v.max}`,
  ptsUnit: "pts",
  nextRing: "Next ring →",
  dayTotal: "Today",
  ringN: (v: Vars) => `Ring ${v.n}`,

  sideQuest: "Quest",
  questContinent: (v: Vars) => `Centre your ring in ${v.continent}.`,
  questLandlocked: "Don't let your ring touch the sea.",
  questIslands: "Islands only: your ring can touch islands, but not the big continents.",
  questTwoContinents: "Make your ring touch two continents.",
  questEquator: "Make your ring cross the equator.",
  questWest: "Keep your whole ring in the Western Hemisphere.",
  questCountry: (v: Vars) => `Centre your ring in ${v.country}.`,
  questNearCity: (v: Vars) => `Keep your ring's centre within ${v.km} km of ${v.city}.`,
  questEast: "Keep your whole ring in the Eastern Hemisphere.",
  questNorthOfCancer: "Keep your whole ring north of the Tropic of Cancer.",
  questSouthOfCapricorn: "Keep your whole ring south of the Tropic of Capricorn.",
  questTropics: "Keep your whole ring inside the tropics.",
  questHigh: (v: Vars) => `Make your ring reach ground higher than ${v.m} m.`,
  highestLine: (v: Vars) => ` (highest ground in your ring: ${v.m} m)`,
  questRule: (v: Vars) => `Skip it and the ring is pass / fail: a pass gets ${v.half} pts, a fail 0.`,
  questDoneLine: "★ Quest complete",
  questSearching: "Looking for a ring that does the quest…",
  questShow: "Show on map ›",
  questSample: "★ Closest that does the quest: ",
  questNoSample: "No ring nearby hits the target and does the quest",
  questMissedLine: (v: Vars) => `Quest not done, so this ring is pass / fail`,
  africa: "Africa",
  asia: "Asia",
  europe: "Europe",
  northAmerica: "North America",
  southAmerica: "South America",
  oceania: "Oceania",
  equator: "Equator",
  primeMeridian: "Prime meridian",
  antimeridian: "180° meridian",
  tropicCancer: "Tropic of Cancer",
  tropicCapricorn: "Tropic of Capricorn",

  // result verdicts: one is picked per result ("|" separates the choices)
  // (same order as the Chinese lists, so both languages pick the matching joke)
  verdictBullseye: "Ringmaster!|That's better than a diamond ring.",
  verdictGood: "Put a finger on my ring.|What! A! Ring!|That's a diamond ring.",
  verdictPass: "You know what you know!|You know everything except for what you don't know!|A win is a win!",
  verdictMeh:
    "But here's my number, so ring me maybe?|Is this a ring or a trap?|You're thinking outside the ring… I see|Next time, we will loop you in.",
  verdictBadFew: "Next time the challenge will be to fit 0 people…|Sharing is caring during spring…|Where do we come from? What are we?",
  verdictBadMany: "It's getting crowded here!|Sharing is caring during spring…|Where do we come from? What are we?",
  verdictOcean: "Under the sea… under the sea…",

  gaugeTarget: "target",
  nobody: "Nobody lives there!",
  onTarget: "Right on target",
  tooMany: (v: Vars) => `${v.amount} too many people`,
  tooFew: (v: Vars) => `${v.amount} too few people`,
  // close rings (🎯 / 🟠) sound encouraging
  onlyTooMany: (v: Vars) => `Only ${v.amount} too many people`,
  onlyTooFew: (v: Vars) => `Only ${v.amount} too few people`,

  searching: "Finding closest ring…",
  foundSelf: "Your ring hits it!",
  searchError: "Couldn't search",
  away: (v: Vars) => `${v.km} km away`,
  noHit: (v: Vars) => `Best nearby (${v.acc}%): ${v.where} · `,
  noneClose: (v: Vars) => `None close within ${v.km} km`,
  centredNear: "Centred near ",
  unnamed: "Open water / unnamed area",

  loadFailed: "Couldn't load population data. Check your connection and try again.",
  copied: "Result copied to clipboard",
  shareFailed: "Couldn't share. Try again.",
  shareTitle: (v: Vars) => `MapRinger #${v.n}`,

  // help dialog
  howToPlay: "How to play",
  demoResult: "<strong>6,556,463</strong> people · 🎯 <strong>80</strong> / 80 pts",
  step1: "Each day: three rings, easy to hard. Each has a size and a target population.",
  step2: "Spin the globe and zoom in to put the ring over a place you think fits.",
  step3:
    "Lock it in. <strong>One</strong> try per ring, then see the real count and the closest ring that would have hit it.",
  helpMaps:
    "<strong>Maps:</strong> ring 1 is on the satellite map (80 pts), ring 2 on a plain map (100 pts), ring 3 on a blank map (150 pts).",
  helpScoring:
    "<strong>Scoring:</strong> the closer to the target, the more points (up to 80, 100 and 150). 🎯 within 15%, 🟠 within 2×, 🟡 within 5×, ⚪ further. Rings 2 and 3 have a quest: skip it and the ring is pass / fail, 🌙 for half points.",
  moreGamesLabel: "Game Rabbit: more games",
  credits: "Credits &amp; licences",
  creditsBody:
    'Population: <a href="https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php" target="_blank" rel="noopener">GHSL GHS-POP R2023A</a> (2025 estimate, 1 km grid), European Commission JRC, CC BY 4.0. Map: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap contributors. Satellite imagery © Esri, Maxar, Earthstar Geographics. Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen Terrain Tiles</a> (SRTM, GMTED, ETOPO1). Place names: <a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a> / OpenStreetMap. Inspired by Tom Forth\'s <a href="https://tomforth.co.uk/circlepopulations/" target="_blank" rel="noopener">circle populations</a>.',
  closeLabel: "Close",
} satisfies Record<string, Entry>;

type Key = keyof typeof en;

const zh: Record<Key, Entry> = {
  appName: "圈地家",
  description: "每日地圖遊戲：把圈圈放在地球上任何地方，圈住剛好目標數量的人口。",
  langButton: "EN",
  langButtonLabel: "Switch to English",
  helpLabel: "玩法",

  todaysRing: "今日之圈",
  practiceRing: "練習圈",
  twistGiant: "特別挑戰 · 超大但空曠的圈",
  twistTiny: "特別挑戰 · 超小但擠擁的圈",
  practiceTag: "· 練習",
  testTag: " · 測試",
  challengeLine: (v) => `用半徑 <strong>${v.radius} 公里</strong>的圈，圈住 <strong>${v.target}</strong> 人`,

  ringLabel: (v) => `第 ${v.n} 圈（共 3 圈）· ${v.map}地圖 · 滿分 ${v.max}`,
  playHint: "拖動和縮放地圖來移動圈圈。每個圈只有一次機會。",
  testHint: "測試模式：無限次嘗試和日子，不會儲存紀錄。",
  lockIn: "鎖定圈圈",
  lockInShort: "鎖定",
  counting: "正在數人…",
  diffEasy: "簡單",
  diffStandard: "標準",
  diffHard: "困難",
  blurbEasy: "衛星圖，有地名和邊界",
  blurbStandard: "淺色地圖，有地名，沒有道路",
  blurbHard: "只有陸地、湖泊和河流",

  yourRing: "你的圈",
  target: "目標",
  shareResult: "分享結果",
  nextRingIn: "下一個圈",
  tryAgain: "再試一次",
  newPuzzle: "新題目",
  showResults: "顯示結果",
  hideResults: "隱藏結果",
  points: (v) => `<strong>${v.points}</strong> / ${v.max} 分`,
  summary: (v) => `<strong>${v.pop}</strong> 人 · ${v.emoji} <strong>${v.points}</strong> / ${v.max}`,
  ptsUnit: "分",
  nextRing: "下一個圈 →",
  dayTotal: "今日",
  ringN: (v) => `第 ${v.n} 圈`,

  sideQuest: "任務",
  questContinent: (v) => `把圈的中心放在${v.continent}。`,
  questLandlocked: "圈內不可以碰到海。",
  questIslands: "只可碰到島嶼，不可碰到大洲本土。",
  questTwoContinents: "讓圈同時碰到兩個大洲。",
  questEquator: "讓圈橫跨赤道。",
  questWest: "整個圈都要在西半球。",
  questCountry: (v) => `把圈的中心放在${v.country}。`,
  questNearCity: (v) => `把圈的中心放在距離${v.city} ${v.km} 公里以內。`,
  questEast: "整個圈都要在東半球。",
  questNorthOfCancer: "整個圈都要在北回歸線以北。",
  questSouthOfCapricorn: "整個圈都要在南回歸線以南。",
  questTropics: "整個圈都要在南北回歸線之間。",
  questHigh: (v) => `圈內要有海拔高於 ${v.m} 米的地方。`,
  highestLine: (v) => `（圈內最高點：海拔 ${v.m} 米）`,
  questRule: (v) => `不完成的話只計合格與否：合格可得 ${v.half} 分，不合格則 0 分。`,
  questDoneLine: "★ 任務完成",
  questSearching: "正在尋找完成任務的圈…",
  questShow: "在地圖上顯示 ›",
  questSample: "★ 最接近又完成任務的圈：",
  questNoSample: "附近找不到既達標又完成任務的圈",
  questMissedLine: (v) => `任務未完成，這個圈只計合格與否`,
  africa: "非洲",
  asia: "亞洲",
  europe: "歐洲",
  northAmerica: "北美洲",
  southAmerica: "南美洲",
  oceania: "大洋洲",
  equator: "赤道",
  primeMeridian: "本初子午線",
  antimeridian: "180 度經線",
  tropicCancer: "北回歸線",
  tropicCapricorn: "南回歸線",

  verdictBullseye: "可圈可點！|你最終爬上了圈裡之巔。",
  verdictGood: "好圈！好圈！|這個圈子，因為有你而充滿朝氣！|當初你沒有進圈我是極力反對的。",
  verdictPass: "知之而知之，不知而不知，是知也！|除去我不懂的，我都懂。|反正成王敗寇，你說呢？",
  verdictMeh: "如果，圈世界我也可以忘記⋯⋯|這是一個圈套！|你很懂得跳出圈圈哦！",
  verdictBadFew: "下一次讓你圈0個人吧⋯⋯|圈圈圓圓圈圈，天天年年天天|我是誰？我在哪裡？",
  verdictBadMany: "好擠啊！|圈圈圓圓圈圈，天天年年天天|我是誰？我在哪裡？",
  verdictOcean: "通常大海裡不住人⋯⋯",

  gaugeTarget: "目標",
  nobody: "那裡沒有人住！",
  onTarget: "正中目標",
  tooMany: (v) => `人數多了 ${v.amount}`,
  tooFew: (v) => `人數少了 ${v.amount}`,
  onlyTooMany: (v) => `只多了 ${v.amount}`,
  onlyTooFew: (v) => `只少了 ${v.amount}`,

  searching: "正在尋找最接近的圈…",
  foundSelf: "你的圈正中目標！",
  searchError: "無法尋找",
  away: (v) => `相距 ${v.km} 公里`,
  noHit: (v) => `附近最接近（${v.acc}%）：${v.where} · `,
  noneClose: (v) => `${v.km} 公里內沒有接近的圈`,
  centredNear: "中心位於 ",
  unnamed: "海上／無名地區",

  loadFailed: "無法載入人口資料，請檢查網絡後再試。",
  copied: "結果已複製",
  shareFailed: "分享失敗，請再試。",
  shareTitle: (v) => `圈地家 #${v.n}`,

  howToPlay: "玩法",
  demoResult: "<strong>6,556,463</strong> 人 · 🎯 <strong>80</strong> / 80 分",
  step1: "每天三個圈，由易到難。每個圈有大小和目標人口。",
  step2: "轉動地球、放大地圖，把圈移到你認為人數剛好的地方。",
  step3: "鎖定圈圈。每個圈只有<strong>一次</strong>機會，之後會顯示真實人數，以及最近的正確圈。",
  helpMaps:
    "<strong>地圖：</strong>第 1 圈用衛星圖（80 分），第 2 圈用淺色地圖（100 分），第 3 圈用空白地圖（150 分）。",
  helpScoring:
    "<strong>計分：</strong>越接近目標，分數越高（滿分分別為 80、100、150）。🎯 相差 15% 以內，🟠 2 倍以內，🟡 5 倍以內，⚪ 更遠。第 2 和第 3 圈有任務：不完成的話只計合格與否，🌙 得一半分數。",
  moreGamesLabel: "Game Rabbit：更多遊戲",
  credits: "鳴謝及授權",
  creditsBody:
    '人口：<a href="https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php" target="_blank" rel="noopener">GHSL GHS-POP R2023A</a>（2025 年估算，1 公里網格），歐盟委員會聯合研究中心（JRC），CC BY 4.0。地圖：<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap 貢獻者。衛星圖像 © Esri, Maxar, Earthstar Geographics。海拔：<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen Terrain Tiles</a>（SRTM、GMTED、ETOPO1）。地名：<a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a> / OpenStreetMap。靈感來自 Tom Forth 的 <a href="https://tomforth.co.uk/circlepopulations/" target="_blank" rel="noopener">circle populations</a>。',
  closeLabel: "關閉",
};

const table: Record<Key, Entry> = LANG === "zh" ? zh : en;

export function t(key: Key, vars: Vars = {}): string {
  const e = table[key];
  return typeof e === "function" ? e(vars) : e;
}

/** Fill in static text tagged in index.html. */
export function applyStaticText(): void {
  document.documentElement.lang = LANG === "zh" ? "zh-Hant" : "en";
  document.title = t("appName");
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("description"));
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]")) el.textContent = t(el.dataset.i18n as Key);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml as Key);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-label]"))
    el.setAttribute("aria-label", t(el.dataset.i18nLabel as Key));
}

/**
 * A people count for the question panel (萬 / 億 grouping in Chinese, so the
 * target is quick to read). Results use full digits (fmt) instead.
 */
export const people = (n: number) => formatPeople(n, LANG);

/** Language for reverse geocoding place names. */
export const PLACE_LANG = LANG === "zh" ? "zh-TW,zh-Hant,zh,en" : "en";
