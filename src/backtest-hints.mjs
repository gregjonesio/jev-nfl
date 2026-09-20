import fs from 'node:fs';
import { loadBaseline } from './baseline.mjs';
import { askJev } from './jev.mjs';
const rows = JSON.parse(fs.readFileSync(new URL('../data/backtest-results.json', import.meta.url), 'utf8')).filter(r => !r.jev.error);
let next = 0;
async function w() { while (next < rows.length) { const i = next++; const st = { ...rows[i].state, league_pass_rate_in_similar_situations: +rows[i].base.p_pass.toFixed(2), league_first_down_rate_in_similar_situations: +rows[i].base.p_conv.toFixed(2) }; if (rows[i].base.fourth) st.league_coach_choice_rates_in_similar_4th_downs = Object.fromEntries(Object.entries(rows[i].base.fourth).map(([k, v]) => [k, +v.toFixed(2)])); rows[i].jev2 = await askJev(st); } }
await Promise.all(Array.from({ length: 8 }, w));
const rp = rows.filter(r => r.grade.play_type && r.jev2.p_pass != null), y = r => r.grade.play_type === 'pass' ? 1 : 0;
const acc = (rs, f) => (rs.filter(f).length / rs.length).toFixed(3);
const brier = (rs, p) => (rs.reduce((s, r) => s + (p(r) - y(r)) ** 2, 0) / rs.length).toFixed(3);
console.log('run/pass with hints: jev acc', acc(rp, r => (r.jev2.p_pass >= 0.5 ? 1 : 0) === y(r)), 'brier', brier(rp, r => r.jev2.p_pass), '| baseline acc', acc(rp, r => (r.base.p_pass >= 0.5 ? 1 : 0) === y(r)), '| plain jev acc', acc(rp, r => (r.jev.p_pass >= 0.5 ? 1 : 0) === y(r)));
const fd = rows.filter(r => r.state.down === 4 && r.grade.fourth_decision && r.jev2.fourth);
const top = d => Object.entries(d).sort((a, b) => b[1] - a[1])[0][0];
console.log('4th with hints: jev acc', acc(fd, r => r.jev2.fourth.choice === r.grade.fourth_decision), '| baseline', acc(fd, r => top(r.base.fourth) === r.grade.fourth_decision), '| plain jev', acc(fd, r => r.jev.fourth.choice === r.grade.fourth_decision), '| go recall', fd.filter(r => r.grade.fourth_decision === 'go_for_it' && r.jev2.fourth.choice === 'go_for_it').length + '/' + fd.filter(r => r.grade.fourth_decision === 'go_for_it').length);
const cv = rows.filter(r => r.grade.play_type && r.jev2.p_conv != null), yc = r => r.grade.converted ? 1 : 0;
console.log('conv with hints: jev brier', (cv.reduce((s, r) => s + (r.jev2.p_conv - yc(r)) ** 2, 0) / cv.length).toFixed(3));
