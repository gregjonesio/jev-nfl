// Scoreboard aggregates, shared by the poller (which builds the page state) and the Worker (replay fallback).
export function tally(preds) {
  const t = { runpass: { n: 0, jev: 0, base: 0, always_pass: 0, jev_brier: 0, base_brier: 0 }, fourth: { n: 0, jev: 0, base: 0, always_punt: 0, go_n: 0, jev_go_recall: 0, base_go_recall: 0, jev_said_go: 0, jev_said_go_right: 0 }, conv: { n: 0, jev_brier: 0, base_brier: 0, rate: 0 }, pending: 0, voided: 0 };
  const byTeam = {};
  for (const p of preds) {
    if (p.status === 'pending') { t.pending++; continue; }
    if (p.status === 'voided') { t.voided++; continue; }
    if (p.status !== 'graded') continue;
    if (p.actual_play && p.p_pass != null) {
      const y = p.actual_play === 'pass' ? 1 : 0;
      t.runpass.n++; t.runpass.always_pass += y; t.runpass.jev += (p.p_pass >= 0.5 ? 1 : 0) === y ? 1 : 0; t.runpass.base += (p.base_p_pass >= 0.5 ? 1 : 0) === y ? 1 : 0;
      t.runpass.jev_brier += (p.p_pass - y) ** 2; t.runpass.base_brier += (p.base_p_pass - y) ** 2;
      if (p.p_conv != null && p.actual_converted != null) { const c = p.actual_converted ? 1 : 0; t.conv.n++; t.conv.rate += c; t.conv.jev_brier += (p.p_conv - c) ** 2; t.conv.base_brier += ((p.base_p_conv ?? 0.3) - c) ** 2; }
    }
    if (p.down === 4 && p.actual_fourth && p.jev_fourth) {
      let bf = null; try { bf = p.base_fourth ? JSON.parse(p.base_fourth) : null; } catch {}
      const bTop = bf ? Object.entries(bf).sort((a, b) => b[1] - a[1])[0][0] : null;
      t.fourth.n++; t.fourth.always_punt += p.actual_fourth === 'punt' ? 1 : 0; t.fourth.jev += p.jev_fourth === p.actual_fourth ? 1 : 0; t.fourth.base += bTop === p.actual_fourth ? 1 : 0;
      if (p.actual_fourth === 'go_for_it') { t.fourth.go_n++; t.fourth.jev_go_recall += p.jev_fourth === 'go_for_it' ? 1 : 0; t.fourth.base_go_recall += bTop === 'go_for_it' ? 1 : 0; }
      if (p.jev_fourth === 'go_for_it') { t.fourth.jev_said_go++; t.fourth.jev_said_go_right += p.actual_fourth === 'go_for_it' ? 1 : 0; }
      const tm = byTeam[p.offense] = byTeam[p.offense] || { team: p.offense, fourth_n: 0, jev_right: 0, went: 0, jev_said_go: 0, agreed_go: 0 };
      tm.fourth_n++; tm.jev_right += p.jev_fourth === p.actual_fourth ? 1 : 0; tm.went += p.actual_fourth === 'go_for_it' ? 1 : 0; tm.jev_said_go += p.jev_fourth === 'go_for_it' ? 1 : 0; tm.agreed_go += (p.jev_fourth === 'go_for_it' && p.actual_fourth === 'go_for_it') ? 1 : 0;
    }
  }
  return { ...t, teams: Object.values(byTeam).sort((a, b) => b.fourth_n - a.fourth_n) };
}

// Fields the page needs; state_json and play_id stay out of the public payload.
export const PUBLIC_FIELDS = ['id', 'game_id', 'seq', 'created_at', 'down', 'distance', 'yte', 'offense', 'defense', 'quarter', 'clock', 'field_position', 'p_pass', 'jev_play', 'play_conf', 'p_conv', 'jev_fourth', 'jev_fourth_probs', 'base_p_pass', 'base_fourth', 'base_p_conv', 'status', 'actual_play', 'actual_fourth', 'actual_converted', 'play_text', 'graded_at', 'latency_ms'];
export const publicRow = (r) => Object.fromEntries(PUBLIC_FIELDS.map(k => [k, r[k] ?? null]));

// games: array of game rows; predsByGame: {gameId: [rows]}; extra: {heartbeat, missed, errors}
export function buildState(games, predsByGame, extra = {}) {
  const all = [];
  const out = games.map(g => {
    const ps = (predsByGame[g.id] || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0)); all.push(...ps);
    return { ...g, tally: tally(ps), pending: ps.filter(p => p.status === 'pending').slice(-1)[0] || null, recent: ps.filter(p => p.status !== 'pending').slice(-14).reverse().map(publicRow), n: ps.length, missed: extra.missedByGame?.[g.id] || 0 };
  });
  const goLedger = all.filter(p => p.down === 4 && p.status === 'graded').sort((a, b) => (b.graded_at || '').localeCompare(a.graded_at || '')).slice(0, 40).map(publicRow);
  for (const g of out) if (g.pending) g.pending = publicRow(g.pending);
  return { updated_at: new Date().toISOString(), heartbeat: extra.heartbeat || new Date().toISOString(), games: out, tally: tally(all), fourth_ledger: goLedger, total: all.length, missed: extra.missed || 0, errors: extra.errors || null };
}
