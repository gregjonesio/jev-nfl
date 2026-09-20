// Replays the held-out games through Jev + baseline and scores both. Same code path the live poller uses for state + grading.
import fs from 'node:fs';
import { rowsFromSummary } from './build-baseline.mjs';
import { loadBaseline, baselinePredict } from './baseline.mjs';
import { askJev } from './jev.mjs';

const dataDir = new URL('../data/', import.meta.url);
const HOLDOUT = JSON.parse(fs.readFileSync(new URL('holdout.json', dataDir), 'utf8'));
const B = loadBaseline();
const rows = [];
for (const id of HOLDOUT) rows.push(...rowsFromSummary(JSON.parse(fs.readFileSync(new URL(`summary-${id}.json`, dataDir), 'utf8'))).map(r => ({ ...r, game: id })));
console.log(`backtest: ${HOLDOUT.length} games, ${rows.length} clean situations, ${rows.filter(r => r.state.down === 4).length} fourth downs`);

const t0 = Date.now(); let next = 0, done = 0;
async function worker() { while (next < rows.length) { const i = next++; rows[i].jev = await askJev(rows[i].state); rows[i].base = baselinePredict(B, rows[i].state); if (++done % 100 === 0) process.stderr.write(`  ${done}/${rows.length}\n`); } }
await Promise.all(Array.from({ length: 8 }, worker));
const ok = rows.filter(r => !r.jev.error); const tok = ok.reduce((s, r) => s + (r.jev.input_tokens || 0), 0);
console.log(`jev ${rows.length} calls, ${rows.length - ok.length} errors, ${((Date.now() - t0) / 1000).toFixed(1)}s, ${tok} tokens, $${(tok / 1e6 * 0.042).toFixed(4)}, p50 ${ok.map(r => r.jev.ms).sort((a, b) => a - b)[Math.floor(ok.length / 2)]}ms`);
if (ok.length < rows.length) console.log('  sample error', JSON.stringify(rows.find(r => r.jev.error).jev));

const fmt = (x, d = 3) => Number.isFinite(x) ? x.toFixed(d) : 'n/a';
const acc = (rs, f) => rs.filter(f).length / rs.length;
const brier = (rs, p, y) => rs.reduce((s, r) => s + (p(r) - y(r)) ** 2, 0) / rs.length;
const ll = (rs, p, y) => rs.reduce((s, r) => { const q = Math.min(Math.max(p(r), 1e-3), 1 - 1e-3); return s - (y(r) ? Math.log(q) : Math.log(1 - q)); }, 0) / rs.length;

const rp = ok.filter(r => r.grade.play_type && r.jev.p_pass != null);
const yPass = r => r.grade.play_type === 'pass' ? 1 : 0;
console.log(`\n== run/pass on ${rp.length} plays (pass rate ${fmt(acc(rp, r => yPass(r)))}) ==`);
console.log('always pass            acc', fmt(acc(rp, r => yPass(r) === 1)));
console.log('coach-tendency baseline acc', fmt(acc(rp, r => (r.base.p_pass >= 0.5 ? 1 : 0) === yPass(r))), 'brier', fmt(brier(rp, r => r.base.p_pass, yPass)), 'logloss', fmt(ll(rp, r => r.base.p_pass, yPass)));
console.log('jev                     acc', fmt(acc(rp, r => (r.jev.p_pass >= 0.5 ? 1 : 0) === yPass(r))), 'brier', fmt(brier(rp, r => r.jev.p_pass, yPass)), 'logloss', fmt(ll(rp, r => r.jev.p_pass, yPass)));
const avg = rp.map(r => ({ ...r, p: (r.jev.p_pass + r.base.p_pass) / 2 }));
console.log('jev+baseline average    acc', fmt(acc(avg, r => (r.p >= 0.5 ? 1 : 0) === yPass(r))), 'brier', fmt(brier(avg, r => r.p, yPass)));
for (const d of [1, 2, 3]) { const sub = rp.filter(r => r.state.down === d); if (sub.length) console.log(`  down ${d} (${sub.length}): baseline ${fmt(acc(sub, r => (r.base.p_pass >= 0.5 ? 1 : 0) === yPass(r)))}  jev ${fmt(acc(sub, r => (r.jev.p_pass >= 0.5 ? 1 : 0) === yPass(r)))}`); }

const fd = ok.filter(r => r.state.down === 4 && r.grade.fourth_decision && r.jev.fourth);
const top = (d) => Object.entries(d).sort((a, b) => b[1] - a[1])[0][0];
console.log(`\n== 4th down on ${fd.length} decisions (${JSON.stringify(fd.reduce((a, r) => (a[r.grade.fourth_decision] = (a[r.grade.fourth_decision] || 0) + 1, a), {}))}) ==`);
console.log('always punt             acc', fmt(acc(fd, r => r.grade.fourth_decision === 'punt')));
console.log('coach-tendency baseline acc', fmt(acc(fd, r => top(r.base.fourth) === r.grade.fourth_decision)), 'logloss', fmt(fd.reduce((s, r) => s - Math.log(Math.max(r.base.fourth[r.grade.fourth_decision], 1e-3)), 0) / fd.length));
console.log('jev                     acc', fmt(acc(fd, r => r.jev.fourth.choice === r.grade.fourth_decision)), 'logloss', fmt(fd.reduce((s, r) => s - Math.log(Math.max(r.jev.fourth.probabilities?.[r.grade.fourth_decision] ?? 0, 1e-3)), 0) / fd.length));
const goes = fd.filter(r => r.grade.fourth_decision === 'go_for_it');
console.log(`  coaches went for it ${goes.length}x: jev called go on ${goes.filter(r => r.jev.fourth.choice === 'go_for_it').length}, baseline on ${goes.filter(r => top(r.base.fourth) === 'go_for_it').length}`);
const jevGo = fd.filter(r => r.jev.fourth.choice === 'go_for_it');
console.log(`  jev said go ${jevGo.length}x: coach actually went ${jevGo.filter(r => r.grade.fourth_decision === 'go_for_it').length}`);

const cv = ok.filter(r => r.grade.play_type && r.jev.p_conv != null);
const yC = r => r.grade.converted ? 1 : 0;
console.log(`\n== first down / TD on ${cv.length} plays (rate ${fmt(acc(cv, r => yC(r)))}) ==`);
console.log('baseline brier', fmt(brier(cv, r => r.base.p_conv, yC)), ' jev brier', fmt(brier(cv, r => r.jev.p_conv, yC)), ' base-rate brier', fmt(acc(cv, r => yC(r)) * (1 - acc(cv, r => yC(r)))));
const calib = (rs, p, y, bins = 5) => { const idx = rs.map((_, i) => i).sort((a, b) => p(rs[a]) - p(rs[b])); const sz = Math.ceil(idx.length / bins); const out = []; for (let b = 0; b < bins; b++) { const sl = idx.slice(b * sz, (b + 1) * sz); if (!sl.length) continue; out.push(`${fmt(sl.reduce((s, i) => s + p(rs[i]), 0) / sl.length, 2)}->${fmt(sl.reduce((s, i) => s + y(rs[i]), 0) / sl.length, 2)}`); } return out.join(' '); };
console.log('jev pass calibration (pred->obs):', calib(rp, r => r.jev.p_pass, yPass));
console.log('jev conv calibration (pred->obs):', calib(cv, r => r.jev.p_conv, yC));
fs.writeFileSync(new URL('backtest-results.json', dataDir), JSON.stringify(rows.map(({ play, ...r }) => r), null, 0));
