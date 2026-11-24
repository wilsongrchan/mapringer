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
  practiceTag: "· practice",
  testTag: " · test",
  challengeLine: (v: Vars) =>
    `Fit <strong>${v.target}</strong> people in <strong>${v.article} ${v.radius} km ring</strong>`,

  ringLabel: (v: Vars) => `Ring ${v.n} of 3`,
  playHint: "Pan and zoom the map to move the ring. One try per ring.",
  testHint: "Test mode: unlimited attempts and days, nothing is saved.",
  lockIn: "Lock in ring",
  lockInShort: "Lock in",
  zoomOutLabel: "Zoom out to the whole globe",
  counting: "Counting people…",
  diffEasy: "Easy",
  diffStandard: "Standard",
  diffHard: "Hard",
  blurbEasy: "Satellite with labels and borders",
  blurbStandard: "Terrain with labels and borders",
  blurbHard: "Terrain only",
  pickMapTitle: "Pick today's map",
  pickMapSub: "You'll play all three of today's rings on it.",
  shareMap: (v: Vars) => `${v.map} map`,

  yourRing: "Your ring",
  target: "Target",
  shareResult: "Share result",
  nextRingIn: "Next ring in",
  tryAgain: "Retry this ring",
  newPuzzle: "New 3 rings",
  showResults: "Show results",
  hideResults: "Hide results",
  points: (v: Vars) => `<strong>${v.points}</strong> / ${v.max} pts`,
  summary: (v: Vars) => `<strong>${v.pop}</strong> people · ${v.emoji} <strong>${v.points}</strong> / ${v.max}`,
  ptsUnit: "pts",
  nextRing: "Next ring →",
  dayTotal: "Today",
  ringN: (v: Vars) => `Ring ${v.n}`,

  sideQuest: "Quest",
  questContinent: (v: Vars) => `Centre your ring on land in ${v.continent} (the sea around it doesn't count).`,
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
  questTouchSea: (v: Vars) => `Make your ring touch ${v.sea}.`,
  questNorthOf: (v: Vars) => `Keep your whole ring north of ${v.lat}°N.`,
  questSouthOf: (v: Vars) => `Keep your whole ring south of ${v.lat}°S.`,
  questCentreAtSea: "Put your ring's centre out at sea.",
  questPrimeMeridian: "Make your ring cross the prime meridian (0° longitude).",
  latN: (v: Vars) => `${v.lat}°N`,
  hemiWest: "Western Hemisphere",
  hemiEast: "Eastern Hemisphere",
  latS: (v: Vars) => `${v.lat}°S`,
  questHigh: (v: Vars) => `Make your ring reach ground higher than ${v.m} m (${v.ft} ft).`,
  highestLine: (v: Vars) => ` (highest ground in your ring: ${v.m} m / ${v.ft} ft)`,
  questRule: (v: Vars) => `Skip quest for a pass/fail score: ${v.half} or 0 pts.`,
  questDoneLine: "★ Quest complete",
  questSearching: "Looking for a ring that does the quest…",
  questShow: "Show on map ›",
  questSample: "★ Closest that does the quest: ",
  questSampleNear: (v: Vars) => `★ Closest that does the quest (${v.acc}% of target): `,
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

  // stats (saved on this device) and practice
  statsLabel: "Stats",
  statsTitle: "Your stats",
  // friends (the Friends tab of the stats dialog; the shared Game Rabbit friend list)
  friendsTab: "Friends",
  friendsSignIn: "Sign in to add friends and see their stats. Once you've played today's three rings, you can see where they put theirs.",
  friendsYou: "You",
  friendsNickname: "Nickname",
  friendsNicknamePh: "Your nickname",
  friendsSave: "Save",
  friendsSaved: "Nickname saved",
  friendsCode: "Your friend code",
  friendsCopyLink: "Copy invite link",
  friendsCopied: "Invite link copied",
  friendsAdd: "Add a friend",
  friendsCodePh: "Their friend code",
  friendsAddBtn: "Add",
  friendsAddSent: (v: Vars) => `Request sent to ${v.name}`,
  friendsAddAccepted: (v: Vars) => `You and ${v.name} are now friends`,
  friendsAddNotFound: "No one has that code",
  friendsAddSelf: "That's your own code",
  friendsAddFailed: "Couldn't add them. Try again.",
  friendsRequests: "Friend requests",
  friendsAccept: "Accept",
  friendsDecline: "Decline",
  friendsList: "Your friends",
  friendsNone: "No friends yet. Send someone your code or invite link.",
  friendsWaiting: "Waiting for them to accept",
  friendsCancel: "Cancel",
  friendsNoName: "(no nickname)",
  friendsShare: "Let friends see where I put today's rings",
  friendsShareNote: "Friends always see your scores, never your spots from past days.",
  friendsBack: "Friends",
  friendsToday: "Today",
  friendsLocked: (v: Vars) => `Finish today's three rings to see where ${v.name} put theirs.`,
  friendsHidden: (v: Vars) => `${v.name} keeps their spots private.`,
  friendsNotPlayed: (v: Vars) => `${v.name} hasn't played today yet.`,
  friendsShowOnMap: "Show on map",
  friendsRemove: "Remove friend",
  friendsRemoveConfirm: (v: Vars) => `Remove ${v.name} from your friends?`,
  friendsError: "Couldn't load friends. Check your connection and try again.",
  friendsLinkSignIn: "Sign in to add your friend",
  friendsStats: "Their stats",
  statPlayed: "Played",
  statStreak: "Streak",
  statBestStreak: "Best streak",
  statAverage: "Average",
  statsLast30: "Last 30 days",
  statsAvgLine: (v: Vars) => `avg ${v.avg}`,
  statsRings: "Your rings",
  friendsRings: "Their rings",
  statsByMap: "By map",
  statsBest: (v: Vars) => `Best day: #${v.n} · ${v.total} / ${v.max}`,
  statsDayTip: (v: Vars) => `#${v.n} · ${v.total} / ${v.max}`,
  statsDayNone: (v: Vars) => `#${v.n} · not finished`,
  statsMapRow: (v: Vars) => `${v.n} ${Number(v.n) === 1 ? "day" : "days"} · avg ${v.avg}`,
  statsMapNone: "Not played yet",
  statsEmpty: "Finish all three of today's rings to start your stats.",
  statsLocal: "Saved in this browser only: clearing your browser data clears it.",
  statsSignedIn: (v: Vars) => `Saved to your Game Rabbit account (${v.email}).`,
  signInToKeep: "Sign in to keep them",
  signOut: "Sign out",
  signInTitle: "Sign in",
  signInSub: "One Game Rabbit account for every game. Your stats and streak follow you to any device. Your email is only used to sign you in.",
  signInGoogle: "Continue with Google",
  or: "or",
  emailLabel: "Email",
  sendCode: "Email me a code",
  codeSent: (v: Vars) => `Enter the code we sent to ${v.email}`,
  signInBtn: "Sign in",
  otherEmail: "Use a different email",
  codeSpam: "Didn't get it? Check your spam folder for an email from noreply@gamerabbit.io.",
  resendIn: (v: Vars) => `Send a new code in ${v.s} s`,
  resend: "Send a new code",
  codeResent: "New code sent",
  signInFailed: "That didn't work. Check the code and try again.",
  sendFailed: "Couldn't send the code. Try again in a minute.",
  signedInToast: "Signed in: your stats are saved to your account",
  signedOutToast: "Signed out",
  gradeBullseye: "🎯 Within 15%",
  gradeGood: "🟠 Within 2×",
  gradeMeh: "🟡 Within 5×",
  gradePass: "🌙 Quest skipped, pass",
  gradeMiss: "⚪ Miss",
  streakLine: (v: Vars) => `Streak: ${v.n} ${Number(v.n) === 1 ? "day" : "days"}`,
  seeStats: "Stats ›",
  practice: "Practice",
  backToday: "← Today's rings",
  backTodayLabel: "Leave practice: back to today's rings",
  pickMapPractice: "Pick a map",
  pickMapPracticeSub: "Practice rings, as many tries as you like. They don't count toward your stats or streak.",
  otherMaps: "Other maps",
  pickGuest: "Playing as a guest: stats stay in this browser. To keep your records,",
  pickSignIn: "sign in / sign up",
  pickGuestEnd: ".",
  pickSignedIn: (v: Vars) => `Signed in as ${v.email}`,
  otherMapsLabel: "Play today's rings again on another map (practice)",
  pickMapReplay: "Play today on another map",
  pickMapReplaySub: "Today's three rings again, as practice: your score, streak and stats stay as they are.",

  // help dialog
  howToPlay: "How to play",
  demoResult: "<strong>6,556,463</strong> people · 🎯 <strong>80</strong> / 80 pts",
  step1: "Three rings a day, each with a size and a target population.",
  step2: "Move the globe to put the ring where you think it fits.",
  step3:
    "Lock it in: <strong>one</strong> try. Then see the real count and the closest ring that hits it.",
  helpMaps: "<strong>Maps:</strong> pick one each day for all three rings.",
  helpScoring:
    '<strong>Scoring:</strong> closer = more points (max 80 · 100 · 150).<ul class="score-key"><li><span>🎯</span>within 15%</li><li><span>🟠</span>within 2×</li><li><span>🟡</span>within 5×</li><li><span>⚪</span>too far off</li><li><span>🌙</span>quest skipped, within 2.5×: half points</li></ul>',
  moreGamesLabel: "Game Rabbit: more games",
  credits: "Credits &amp; licences",
  creditsBody:
    'Population: <a href="https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php" target="_blank" rel="noopener">GHSL GHS-POP R2023A</a> (2025 estimate, 1 km grid), European Commission JRC, CC BY 4.0. Map: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap contributors. Satellite imagery © Esri, Maxar, Earthstar Geographics. Elevation: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen Terrain Tiles</a> (SRTM, GMTED, ETOPO1). Place names: <a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a> / OpenStreetMap. Inspired by Tom Forth\'s <a href="https://tomforth.co.uk/circlepopulations/" target="_blank" rel="noopener">circle populations</a>.',
  closeLabel: "Close",
  hideChallenge: "Hide the details (show more of the map)",
  showChallenge: "Show the ring's details",
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
  practiceTag: "· 練習",
  testTag: " · 測試",
  challengeLine: (v) => `用半徑 <strong>${v.radius} 公里</strong>的圈，圈住 <strong>${v.target}</strong> 人`,

  ringLabel: (v) => `第 ${v.n} 圈（共 3 圈）`,
  playHint: "拖動和縮放地圖來移動圈圈。每個圈只有一次機會。",
  testHint: "測試模式：無限次嘗試和日子，不會儲存紀錄。",
  lockIn: "鎖定圈圈",
  lockInShort: "鎖定",
  zoomOutLabel: "縮小至整個地球",
  counting: "正在數人…",
  diffEasy: "簡單",
  diffStandard: "標準",
  diffHard: "困難",
  blurbEasy: "標有地名和邊界的衛星圖",
  blurbStandard: "標有地名和邊界的地形圖",
  blurbHard: "沒有任何標注的地形圖",
  pickMapTitle: "選擇今日的地圖",
  pickMapSub: "今日的三個圈都會用這張地圖。",
  shareMap: (v) => `${v.map}地圖`,

  yourRing: "你的圈",
  target: "目標",
  shareResult: "分享結果",
  nextRingIn: "下一個圈",
  tryAgain: "重玩這個圈",
  newPuzzle: "換三個新圈",
  showResults: "顯示結果",
  hideResults: "隱藏結果",
  points: (v) => `<strong>${v.points}</strong> / ${v.max} 分`,
  summary: (v) => `<strong>${v.pop}</strong> 人 · ${v.emoji} <strong>${v.points}</strong> / ${v.max}`,
  ptsUnit: "分",
  nextRing: "下一個圈 →",
  dayTotal: "今日",
  ringN: (v) => `第 ${v.n} 圈`,

  sideQuest: "任務",
  questContinent: (v) => `把圈的中心放在${v.continent}的陸地上（附近海域不計）。`,
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
  questTouchSea: (v) => `讓圈碰到${v.sea}。`,
  questNorthOf: (v) => `整個圈都要在北緯 ${v.lat} 度以北。`,
  questSouthOf: (v) => `整個圈都要在南緯 ${v.lat} 度以南。`,
  questCentreAtSea: "把圈的中心放在海上。",
  questPrimeMeridian: "讓圈橫跨本初子午線（經度 0°）。",
  latN: (v) => `北緯 ${v.lat}°`,
  hemiWest: "西半球",
  hemiEast: "東半球",
  latS: (v) => `南緯 ${v.lat}°`,
  questHigh: (v) => `圈內要有海拔高於 ${v.m} 米的地方。`,
  highestLine: (v) => `（圈內最高點：海拔 ${v.m} 米）`,
  questRule: (v) => `不做任務則只計合格與否：${v.half} 或 0 分。`,
  questDoneLine: "★ 任務完成",
  questSearching: "正在尋找完成任務的圈…",
  questShow: "在地圖上顯示 ›",
  questSample: "★ 最接近又完成任務的圈：",
  questSampleNear: (v) => `★ 完成任務而最接近目標的圈（${v.acc}%）：`,
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

  statsLabel: "統計",
  statsTitle: "成績總結",
  // 好友（戰績視窗的「好友」分頁；Game Rabbit 共用的好友名單）
  friendsTab: "好友",
  friendsSignIn: "登入後可以加好友、看他們的戰績。玩完今日三個圈後，還可以看到他們把圈放在哪裡。",
  friendsYou: "你",
  friendsNickname: "暱稱",
  friendsNicknamePh: "你的暱稱",
  friendsSave: "儲存",
  friendsSaved: "已儲存暱稱",
  friendsCode: "你的好友碼",
  friendsCopyLink: "複製邀請連結",
  friendsCopied: "已複製邀請連結",
  friendsAdd: "加好友",
  friendsCodePh: "對方的好友碼",
  friendsAddBtn: "加入",
  friendsAddSent: (v) => `已向 ${v.name} 發出邀請`,
  friendsAddAccepted: (v) => `你和 ${v.name} 已成為好友`,
  friendsAddNotFound: "找不到這個好友碼",
  friendsAddSelf: "這是你自己的好友碼",
  friendsAddFailed: "未能加入，請再試。",
  friendsRequests: "好友邀請",
  friendsAccept: "接受",
  friendsDecline: "拒絕",
  friendsList: "你的好友",
  friendsNone: "還沒有好友。把好友碼或邀請連結傳給朋友吧。",
  friendsWaiting: "等待對方接受",
  friendsCancel: "取消",
  friendsNoName: "（未設暱稱）",
  friendsShare: "讓好友看到我今日的圈放在哪裡",
  friendsShareNote: "好友總能看到你的分數，但看不到你以前的圈放在哪裡。",
  friendsBack: "好友",
  friendsToday: "今日",
  friendsLocked: (v) => `完成今日三個圈後，就能看到 ${v.name} 把圈放在哪裡。`,
  friendsHidden: (v) => `${v.name} 沒有公開圈的位置。`,
  friendsNotPlayed: (v) => `${v.name} 今日還未玩。`,
  friendsShowOnMap: "在地圖上看",
  friendsRemove: "刪除好友",
  friendsRemoveConfirm: (v) => `確定把 ${v.name} 從好友中刪除？`,
  friendsError: "未能載入好友，請檢查網絡後再試。",
  friendsLinkSignIn: "登入後即可加好友",
  friendsStats: "他們的戰績",
  statPlayed: "已玩日數",
  statStreak: "連續日數",
  statBestStreak: "最長連續",
  statAverage: "平均得分",
  statsLast30: "最近 30 日",
  statsAvgLine: (v) => `平均 ${v.avg}`,
  statsRings: "圈地成績",
  friendsRings: "圈地成績",
  statsByMap: "地圖難度",
  statsBest: (v) => `最佳一日：#${v.n} · ${v.total} / ${v.max}`,
  statsDayTip: (v) => `#${v.n} · ${v.total} / ${v.max}`,
  statsDayNone: (v) => `#${v.n} · 未完成`,
  statsMapRow: (v) => `${v.n} 日 · 平均 ${v.avg}`,
  statsMapNone: "未玩過",
  statsEmpty: "完成今日的三個圈，就會開始記錄統計。",
  statsLocal: "只儲存在這個瀏覽器：清除瀏覽器資料會一併刪除。",
  statsSignedIn: (v) => `已儲存到你的 Game Rabbit 帳戶（${v.email}）。`,
  signInToKeep: "登入以保留紀錄",
  signOut: "登出",
  signInTitle: "登入",
  signInSub: "只需一個 Game Rabbit 帳戶即可紀錄所有遊戲成績！登記帳戶後，成績總結和連續日數等資料在任何裝置上都能看到。電郵只用作登入，不作宣傳或其他用途。",
  signInGoogle: "使用 Google 繼續",
  or: "或",
  emailLabel: "電郵",
  sendCode: "取得驗證碼",
  codeSent: (v) => `輸入我們傳送到 ${v.email} 的驗證碼`,
  signInBtn: "登入",
  otherEmail: "使用其他電郵",
  codeSpam: "收不到？請檢查垃圾郵件匣，寄件人是 noreply@gamerabbit.io。",
  resendIn: (v) => `${v.s} 秒後可重新取得驗證碼`,
  resend: "重新取得驗證碼",
  codeResent: "已傳送新的驗證碼",
  signInFailed: "登入失敗，請檢查驗證碼再試一次。",
  sendFailed: "無法傳送驗證碼，請稍後再試。",
  signedInToast: "已登入：統計會儲存到你的帳戶",
  signedOutToast: "已登出",
  gradeBullseye: "🎯 相差 15% 以內",
  gradeGood: "🟠 2 倍以內",
  gradeMeh: "🟡 5 倍以內",
  gradePass: "🌙 未完成任務，合格",
  gradeMiss: "⚪ 相差太多",
  streakLine: (v) => `連續 ${v.n} 日`,
  seeStats: "統計 ›",
  practice: "練習",
  backToday: "← 今日的圈",
  backTodayLabel: "離開練習：回到今日的圈",
  pickMapPractice: "選擇地圖",
  pickMapPracticeSub: "練習用的圈，可以無限次重試。練習成績不會計入成績總結或連續日數。",
  otherMaps: "其他地圖",
  pickGuest: "現以訪客身分遊玩：成績只儲存在這個瀏覽器。如想保存成績紀錄，請",
  pickSignIn: "登入／登記",
  pickGuestEnd: "。",
  pickSignedIn: (v) => `已登入：${v.email}`,
  otherMapsLabel: "用另一張地圖再玩今日的圈（練習）",
  pickMapReplay: "用另一張地圖玩今日的圈",
  pickMapReplaySub: "再玩一次今日的三個圈，當作練習：你的分數、連續日數和統計都不會改變。",

  howToPlay: "玩法",
  demoResult: "<strong>6,556,463</strong> 人 · 🎯 <strong>80</strong> / 80 分",
  step1: "每日三個圈，各有大小和目標人口。",
  step2: "移動地球，把圈放到你認為人數剛好的地方。",
  step3: "鎖定：只有<strong>一次</strong>機會，之後顯示真實人數和最近的正確圈。",
  helpMaps: "<strong>地圖：</strong>每日選一張，三個圈都用它。",
  helpScoring:
    '<strong>計分：</strong>越接近目標，分數越高（滿分 80 · 100 · 150）。<ul class="score-key"><li><span>🎯</span>相差 15% 以內</li><li><span>🟠</span>2 倍以內</li><li><span>🟡</span>5 倍以內</li><li><span>⚪</span>相差太遠</li><li><span>🌙</span>未完成任務，2.5 倍以內：得一半分數</li></ul>',
  moreGamesLabel: "Game Rabbit：更多遊戲",
  credits: "鳴謝及授權",
  creditsBody:
    '人口：<a href="https://human-settlement.emergency.copernicus.eu/ghs_pop2023.php" target="_blank" rel="noopener">GHSL GHS-POP R2023A</a>（2025 年估算，1 公里網格），歐盟委員會聯合研究中心（JRC），CC BY 4.0。地圖：<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © OpenMapTiles © OpenStreetMap 貢獻者。衛星圖像 © Esri, Maxar, Earthstar Geographics。海拔：<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen Terrain Tiles</a>（SRTM、GMTED、ETOPO1）。地名：<a href="https://nominatim.org" target="_blank" rel="noopener">Nominatim</a> / OpenStreetMap。靈感來自 Tom Forth 的 <a href="https://tomforth.co.uk/circlepopulations/" target="_blank" rel="noopener">circle populations</a>。',
  closeLabel: "關閉",
  hideChallenge: "收起詳情（顯示更多地圖）",
  showChallenge: "顯示這個圈的詳情",
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
