/**
 * People counts. English: 1,700,000. Traditional Chinese groups by 萬 (10⁴)
 * and 億 (10⁸): 4,000 · 6萬5000 · 1700萬 · 13億 · 9億3800萬 · 6萬零50.
 */
export function formatPeople(n: number, lang: "en" | "zh"): string {
  const v = Math.round(n);
  if (lang !== "zh" || v < 10_000) return v.toLocaleString("en-US");
  const yi = Math.floor(v / 1e8);
  const wan = Math.floor((v % 1e8) / 1e4);
  const rest = v % 1e4;
  // 零 marks a skipped place: 6萬零50 (60,050), 1億零500萬 (105,000,000)
  let out = yi ? `${yi}億` : "";
  if (wan) out += (yi && wan < 1000 ? "零" : "") + `${wan}萬`;
  if (rest) out += ((yi || wan) && (rest < 1000 || (yi && !wan)) ? "零" : "") + String(rest);
  return out;
}
