/**
 * UI text in English and Traditional Chinese (圈地家).
 *
 * Language: ?lang=zh / ?lang=en, else the saved choice, else the browser's
 * language (any zh-* → Traditional Chinese). Static text in index.html is
 * tagged with data-i18n (text) or data-i18n-html (markup) and filled in by
 * applyStaticText().
 */
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

  playHint: "Pan and zoom the map to move the ring. You get one try per day.",
  testHint: "Test mode: unlimited attempts and puzzles, nothing is saved.",
  lockIn: "Lock in ring",
  counting: "Counting people…",
  diffEasy: "Easy",
  diffStandard: "Standard",
  diffHard: "Hard",
  blurbEasy: "Satellite with labels and borders",
  blurbStandard: "Light map with labels, no roads",
  blurbHard: "Land, lakes and rivers only",
  diffInfo: (v: Vars) => `${v.blurb} · ×${v.mult} points${v.locked ? " · locked for today" : ""}`,

  yourRing: "Your ring",
  target: "Target",
  shareResult: "Share result",
  nextRingIn: "Next ring in",
  tryAgain: "Try again",
  newPuzzle: "New puzzle",
  showResults: "Show results",
  hideResults: "Hide results",
  points: (v: Vars) => `×${v.mult} = <strong>${v.points}</strong> pts`,
  summary: (v: Vars) => `<strong>${v.pop}</strong> people · ${v.bar} <strong>${v.score}</strong> ${v.unit}`,
  ptsUnit: "pts",

  bullseye: "Bullseye! 🎯",
  close: "So close. Great ring.",
  solid: "Solid placement.",
  ballparkCrowded: "In the ballpark, but too crowded.",
  ballparkEmpty: "In the ballpark, but too empty.",
  wayTooMany: "Way too many people!",
  wayTooFew: "Way too few people!",

  gaugeTarget: "target",
  nobody: "Nobody lives there!",
  onTarget: "Right on target",
  tooMany: (v: Vars) => `${v.amount} too many people`,
  tooFew: (v: Vars) => `${v.amount} too few people`,

  searching: "Finding the closest correct ring…",
  foundSelf: "You found a correct ring yourself!",
  searchError: "Couldn't search for the closest correct ring.",
  away: (v: Vars) => `${v.km} km away`,
  closest: (v: Vars) => `Closest correct ring: <strong>${v.pop}</strong> people, ${v.where}.`,
  noHit: (v: Vars) =>
    `No ring within ${v.km} km hits the target. Best nearby: <strong>${v.pop}</strong> (${v.acc}%), ${v.where}.`,
  noneClose: (v: Vars) => `No ring within ${v.km} km comes close to this target.`,
  centredNear: "Centred near ",
  unnamed: "Open water / unnamed area",

  loadFailed: "Couldn't load population data. Check your connection and try again.",
  copied: "Result copied to clipboard",
  shareFailed: "Couldn't share. Try again.",
  shareTitle: (v: Vars) => `MapRinger #${v.n} · ${v.radius} km ring${v.level}`,

  // help dialog
  howToPlay: "How to play",
  demoResult: "<strong>49,800</strong> people · target 51,000 · <strong>100</strong> 🎯",
  step1: "Each day: one ring size, one target population.",
  step2: "Pan the map to move the ring over a place you think fits.",
  step3:
    "Lock it in. You get <strong>one</strong> try, then see the real count and the closest ring that would have hit it.",
  helpMaps:
    "<strong>Maps:</strong> Hard (land, lakes, rivers) ×1.2 · Standard (no roads) ×1 · Easy (satellite) ×0.8. You start on Hard and can only switch to an easier map.",
  helpScoring:
    "<strong>Scoring</strong> (out of 100): within 5% of the target is a perfect 100. After that it drops on a log scale: 2× too many (or too few) scores about 70, 10× off about 27.",
  credits: "Credits &amp; licences",
  creditsBody:
    'Population: <a href="https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php" target="_blank" rel="noopener">GHSL GHS-POP R2023A</a> (2025 estimate, 1 km grid), European Commission JRC, CC BY 4.0. Map: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap contributors. Satellite imagery © Esri, Maxar, Earthstar Geographics. Place names: <a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a> / OpenStreetMap. Inspired by Tom Forth\'s <a href="https://tomforth.co.uk/circlepopulations/" target="_blank" rel="noopener">circle populations</a>.',
  gotIt: "Got it",
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

  playHint: "拖動和縮放地圖來移動圈圈。每天只有一次機會。",
  testHint: "測試模式：無限次嘗試和題目，不會儲存紀錄。",
  lockIn: "鎖定圈圈",
  counting: "正在數人…",
  diffEasy: "簡單",
  diffStandard: "標準",
  diffHard: "困難",
  blurbEasy: "衛星圖，有地名和邊界",
  blurbStandard: "淺色地圖，有地名，沒有道路",
  blurbHard: "只有陸地、湖泊和河流",
  diffInfo: (v) => `${v.blurb} · 分數 ×${v.mult}${v.locked ? " · 今天已鎖定" : ""}`,

  yourRing: "你的圈",
  target: "目標",
  shareResult: "分享結果",
  nextRingIn: "下一個圈",
  tryAgain: "再試一次",
  newPuzzle: "新題目",
  showResults: "顯示結果",
  hideResults: "隱藏結果",
  points: (v) => `×${v.mult} = <strong>${v.points}</strong> 分`,
  summary: (v) => `<strong>${v.pop}</strong> 人 · ${v.bar} <strong>${v.score}</strong> ${v.unit}`,
  ptsUnit: "分",

  bullseye: "正中目標！🎯",
  close: "非常接近，好圈！",
  solid: "放得不錯。",
  ballparkCrowded: "差不多，但人太多了。",
  ballparkEmpty: "差不多，但人太少了。",
  wayTooMany: "人太多了！",
  wayTooFew: "人太少了！",

  gaugeTarget: "目標",
  nobody: "那裡沒有人住！",
  onTarget: "正中目標",
  tooMany: (v) => `人數多了 ${v.amount}`,
  tooFew: (v) => `人數少了 ${v.amount}`,

  searching: "正在尋找最近的正確圈…",
  foundSelf: "你自己就找到了正確的圈！",
  searchError: "無法尋找最近的正確圈。",
  away: (v) => `相距 ${v.km} 公里`,
  closest: (v) => `最近的正確圈：<strong>${v.pop}</strong> 人，${v.where}。`,
  noHit: (v) => `${v.km} 公里內沒有圈能達到目標。附近最接近：<strong>${v.pop}</strong> 人（${v.acc}%），${v.where}。`,
  noneClose: (v) => `${v.km} 公里內沒有接近這個目標的圈。`,
  centredNear: "中心位於 ",
  unnamed: "海上／無名地區",

  loadFailed: "無法載入人口資料，請檢查網絡後再試。",
  copied: "結果已複製",
  shareFailed: "分享失敗，請再試。",
  shareTitle: (v) => `圈地家 #${v.n} · 半徑 ${v.radius} 公里${v.level}`,

  howToPlay: "玩法",
  demoResult: "<strong>49,800</strong> 人 · 目標 51,000 · <strong>100</strong> 🎯",
  step1: "每天一題：一個圈的大小，一個目標人口。",
  step2: "拖動地圖，把圈移到你認為人數剛好的地方。",
  step3: "鎖定圈圈。你只有<strong>一次</strong>機會，之後會顯示真實人數，以及最近的正確圈。",
  helpMaps:
    "<strong>地圖：</strong>困難（只有陸地、湖泊、河流）×1.2 · 標準（沒有道路）×1 · 簡單（衛星圖）×0.8。一開始是困難模式，只能轉到較簡單的地圖。",
  helpScoring:
    "<strong>計分</strong>（滿分 100）：與目標相差 5% 以內就是滿分。之後按對數遞減：多了或少了 2 倍約 70 分，相差 10 倍約 27 分。",
  credits: "鳴謝及授權",
  creditsBody:
    '人口：<a href="https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php" target="_blank" rel="noopener">GHSL GHS-POP R2023A</a>（2025 年估算，1 公里網格），歐盟委員會聯合研究中心（JRC），CC BY 4.0。地圖：<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap 貢獻者。衛星圖像 © Esri, Maxar, Earthstar Geographics。地名：<a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a> / OpenStreetMap。靈感來自 Tom Forth 的 <a href="https://tomforth.co.uk/circlepopulations/" target="_blank" rel="noopener">circle populations</a>。',
  gotIt: "明白",
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

/** Language for reverse geocoding place names. */
export const PLACE_LANG = LANG === "zh" ? "zh-TW,zh-Hant,zh,en" : "en";
