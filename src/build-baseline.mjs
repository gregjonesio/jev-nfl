// Builds data/baseline.json from saved ESPN summaries, holding out the games listed in HOLDOUT for the backtest.
import fs from 'node:fs';
import { allPlays, teamsOf, gradePlay, nextState } from './espn.mjs';
import { buildBaseline } from './baseline.mjs';

const dataDir = new URL('../data/', import.meta.url);
const events = JSON.parse(fs.readFileSync(new URL('events.json', dataDir), 'utf8')).filter(e => e.state === 'post');
// hold out the most recent 4 finished games
const sorted = events.slice().sort((a, b) => a.date.localeCompare(b.date));
const HOLDOUT = sorted.slice(-4).map(e => e.id);
fs.writeFileSync(new URL('holdout.json', dataDir), JSON.stringify(HOLDOUT));

export function rowsFromSummary(s) {
  const teams = teamsOf(s), plays = allPlays(s), rows = [];
  for (let i = 0; i < plays.length - 1; i++) {
    const st = nextState(plays[i], teams, plays.slice(0, i + 1)); if (!st) continue;
    // find next scrimmage play; require its start to match the predicted situation
    let j = i + 1, g = null;
    while (j < plays.length) { g = gradePlay(plays[j]); if (g) break; j++; }
    if (!g) continue;
    const p = plays[j]; const sk = p.start?.team?.id && p.start.down ? `${p.start.team.id}|${p.start.down}|${p.start.distance}|${p.start.yardsToEndzone}` : null;
    if (sk !== st.key) continue; // situation changed (penalty etc.), not a clean prediction
    rows.push({ state: st, grade: g, play: p });
  }
  return rows;
}

if (process.argv[1] && process.argv[1].endsWith('build-baseline.mjs')) {
  const rows = [];
  for (const e of events) { if (HOLDOUT.includes(e.id)) continue; const s = JSON.parse(fs.readFileSync(new URL(`summary-${e.id}.json`, dataDir), 'utf8')); rows.push(...rowsFromSummary(s)); }
  const B = buildBaseline(rows);
  fs.writeFileSync(new URL('baseline.json', dataDir), JSON.stringify(B));
  const fourth = rows.filter(r => r.state.down === 4 && r.grade.fourth_decision);
  console.log(`baseline from ${events.length - HOLDOUT.length} games: ${rows.length} clean scrimmage situations, pass rate ${(B.global.pass / B.global.n).toFixed(3)}, 4th downs ${fourth.length} (${JSON.stringify(B.global.fourth)}), conversion rate ${(B.global.conv / B.global.convN).toFixed(3)}`);
  console.log('holdout games:', HOLDOUT.join(', '));
}
