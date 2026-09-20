// Coach-tendency baseline: smoothed bucket tables built from ESPN play-by-play of prior weeks.
// Build: node src/build-baseline.mjs   -> data/baseline.json. Lookup: baselinePredict(state).
import fs from 'node:fs';

export const ytgBucket = (d) => d <= 1 ? '1' : d <= 3 ? '2-3' : d <= 6 ? '4-6' : d <= 10 ? '7-10' : '11+';
export const yteBucket = (y) => y >= 90 ? 'own<=10' : y >= 70 ? 'own11-30' : y >= 31 ? 'mid' : y >= 11 ? 'opp11-30' : 'opp<=10';
export const ytg4Bucket = (d) => d <= 1 ? '1' : d <= 3 ? '2-3' : d <= 7 ? '4-7' : '8+';
export const yte4Bucket = (y) => y <= 5 ? '1-5' : y <= 15 ? '6-15' : y <= 35 ? '16-35' : y <= 55 ? '36-55' : '56+';
export function situation(st) {
  const late = (st.quarter === 4 && (st.seconds_left_in_half ?? 900) <= 600) || (st.quarter === 2 && (st.seconds_left_in_half ?? 900) <= 120);
  if (late && st.score_diff < 0) return 'late-trailing';
  if (late && st.score_diff > 0) return 'late-leading';
  return 'normal';
}
export const rpKey = (st) => `${st.down}|${ytgBucket(st.distance)}|${yteBucket(st.yards_to_endzone)}|${situation(st)}`;
export const rpKeyCoarse = (st) => `${st.down}|${ytgBucket(st.distance)}`;
export const fdKey = (st) => `${ytg4Bucket(st.distance)}|${yte4Bucket(st.yards_to_endzone)}|${situation(st)}`;
export const fdKeyCoarse = (st) => `${ytg4Bucket(st.distance)}|${yte4Bucket(st.yards_to_endzone)}`;

export function buildBaseline(rows) {
  // rows: [{state, grade}] from prior games
  const B = { pass: {}, passCoarse: {}, fourth: {}, fourthCoarse: {}, conv: {}, global: { pass: 0, n: 0, fourth: { go_for_it: 0, punt: 0, field_goal: 0 }, conv: 0, convN: 0 } };
  const add = (tbl, k, v) => { tbl[k] = tbl[k] || { n: 0, s: 0 }; tbl[k].n++; tbl[k].s += v; };
  const add3 = (tbl, k, d) => { tbl[k] = tbl[k] || { go_for_it: 0, punt: 0, field_goal: 0 }; tbl[k][d]++; };
  for (const { state: st, grade: g } of rows) {
    if (g.play_type) { const v = g.play_type === 'pass' ? 1 : 0; add(B.pass, rpKey(st), v); add(B.passCoarse, rpKeyCoarse(st), v); B.global.pass += v; B.global.n++; add(B.conv, `${st.down}|${ytgBucket(st.distance)}`, g.converted ? 1 : 0); B.global.conv += g.converted ? 1 : 0; B.global.convN++; }
    if (st.down === 4 && g.fourth_decision) { add3(B.fourth, fdKey(st), g.fourth_decision); add3(B.fourthCoarse, fdKeyCoarse(st), g.fourth_decision); B.global.fourth[g.fourth_decision]++; }
  }
  return B;
}

export function loadBaseline(path = new URL('../data/baseline.json', import.meta.url)) { return JSON.parse(fs.readFileSync(path, 'utf8')); }

export function baselinePredict(B, st) {
  const K = 8; // smoothing pseudo-count
  const gp = B.global.pass / Math.max(B.global.n, 1);
  const c = B.passCoarse[rpKeyCoarse(st)]; const pc = c ? (c.s + K * gp) / (c.n + K) : gp;
  const f = B.pass[rpKey(st)]; const p_pass = f ? (f.s + K * pc) / (f.n + K) : pc;
  const cv = B.conv[`${st.down}|${ytgBucket(st.distance)}`]; const gc = B.global.conv / Math.max(B.global.convN, 1);
  const p_conv = cv ? (cv.s + K * gc) / (cv.n + K) : gc;
  let fourth = null;
  if (st.down === 4) {
    const G = B.global.fourth, gt = G.go_for_it + G.punt + G.field_goal || 1;
    const gdist = { go_for_it: G.go_for_it / gt, punt: G.punt / gt, field_goal: G.field_goal / gt };
    const mix = (tbl, prior) => { if (!tbl) return prior; const n = tbl.go_for_it + tbl.punt + tbl.field_goal; const d = {}; for (const k of Object.keys(prior)) d[k] = (tbl[k] + K * prior[k]) / (n + K); return d; };
    fourth = mix(B.fourth[fdKey(st)], mix(B.fourthCoarse[fdKeyCoarse(st)], gdist));
  }
  return { p_pass, p_conv, fourth };
}
