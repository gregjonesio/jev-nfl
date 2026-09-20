// Live poller: watches ESPN, asks Jev before each snap, grades after, pushes to the Worker, and appends a local JSONL ledger.
// Usage: node src/live.mjs                              (live, today's games, exits at 23:45 local)
//        node src/live.mjs --replay 401872926 --speed 1200 [--batch 3]   (replay a saved game into the Worker as a replay game)
//        node src/live.mjs --clear-replay
import fs from 'node:fs';
import path from 'node:path';
import { scoreboard, summary, teamsOf, allPlays, gradePlay, nextState, stateKeyOfStart } from './espn.mjs';
import { loadBaseline, baselinePredict } from './baseline.mjs';
import { askJev, hintsFrom, MODEL } from './jev.mjs';
import { buildState } from './tally.mjs';

const args = process.argv.slice(2);
const arg = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const REPLAY = arg('--replay'); const SPEED = Number(arg('--speed', 1200)); const BATCH = Number(arg('--batch', 1)); const CLEAR = args.includes('--clear-replay');
const WORKER = process.env.JEV_NFL_WORKER || 'https://jev-nfl.gregoryalanjones.workers.dev';
const POLL_MS = 10000, IDLE_MS = 60000, SUMMARY_CONCURRENCY = 3;
const dataDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const B = loadBaseline();
const tokRaw = fs.readFileSync('C:/Users/grego/secrets/jev-nfl/.env', 'utf8'); const TOKEN = (tokRaw.match(/^\s*INGEST_TOKEN\s*=\s*(.+)\s*$/m) || [])[1]?.trim();
if (!TOKEN) { console.error('no INGEST_TOKEN'); process.exit(1); }
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const day = new Date().toISOString().slice(0, 10);
const ledgerPath = path.join(dataDir, `ledger-${REPLAY ? 'replay' : day}.jsonl`);
const outboxPath = path.join(dataDir, `outbox-${REPLAY ? 'replay' : day}.jsonl`);
const ledger = (o) => { try { fs.appendFileSync(ledgerPath, JSON.stringify(o) + '\n'); } catch (e) { log('ledger write failed', e.message); } };
const errors = { jev: 0, espn: 0, push: 0, cycle: 0 };
process.on('unhandledRejection', (e) => log('unhandled rejection', e?.message || e));
process.on('uncaughtException', (e) => log('uncaught exception', e?.message || e));

// ---- durable outbox: rows that failed to reach the Worker are written to disk and retried oldest-first ----
function outboxLoad() { try { return fs.existsSync(outboxPath) ? fs.readFileSync(outboxPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; } catch (e) { log('outbox read failed', e.message); return []; } }
function outboxSave(rows) { try { fs.writeFileSync(outboxPath, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); } catch (e) { log('outbox write failed', e.message); } }
async function postIngest(body) {
  const r = await fetch(WORKER + '/ingest', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
  if (r.status === 401) throw new Error('ingest unauthorized (token mismatch), not retrying');
  if (!r.ok) throw new Error(`ingest HTTP ${r.status} ${(await r.text()).slice(0, 100)}`);
  return true;
}
async function push(body) {
  // drain the outbox first so ordering stays oldest-first
  const queued = outboxLoad();
  const predictions = [...queued, ...(body.predictions || [])];
  for (let a = 0; a < 2; a++) {
    try { await postIngest({ ...body, predictions }); if (queued.length) { log(`outbox drained: ${queued.length} rows`); } outboxSave([]); return true; }
    catch (e) { errors.push++; log('push failed', e.message); if (/unauthorized/.test(e.message)) break; await new Promise(r => setTimeout(r, 2000 * (a + 1))); }
  }
  // dedupe by id keeping the latest version, persist
  const byId = new Map(); for (const p of predictions) byId.set(p.id, p);
  outboxSave([...byId.values()]);
  return false;
}
if (CLEAR) { try { await postIngest({ delete_replay: true }); log('replay rows cleared'); } catch (e) { log(e.message); } process.exit(0); }

const games = {}; // id -> { teams, seen:Map(id->fingerprint), pending, lastPredictedFor, closed, rows:{id->row}, missed, row }
const fp = (p) => `${p.type?.text}|${p.text}|${JSON.stringify(p.start)}|${JSON.stringify(p.end)}|${p.homeScore}-${p.awayScore}`;

function gameRow(ev, s, replay) {
  const comp = ev.competitions?.[0] || s?.header?.competitions?.[0] || {};
  const comps = comp.competitors || [];
  const home = comps.find(c => c.homeAway === 'home'), away = comps.find(c => c.homeAway === 'away');
  const st = comp.status || ev.status || s?.header?.competitions?.[0]?.status || {};
  return { id: (ev.id || s.header.id) + (replay ? '-replay' : ''), name: ev.name || s?.header?.competitions?.[0]?.competitors?.map(c => c.team.displayName).join(' at '), short_name: ev.shortName || `${away?.team?.abbreviation} @ ${home?.team?.abbreviation}`,
    date: replay ? '2000-01-01T00:00Z' : (ev.date || comp.date), status: st.type?.detail || st.type?.description, state: st.type?.state, home_abbr: home?.team?.abbreviation, away_abbr: away?.team?.abbreviation,
    home_score: Number(home?.score ?? 0), away_score: Number(away?.score ?? 0), period: st.period, clock: st.displayClock, replay: replay ? 1 : 0 };
}
function gradeInto(row, p, grade, match) {
  Object.assign(row, match
    ? { status: 'graded', actual_play: grade.play_type, actual_fourth: grade.fourth_decision, actual_converted: grade.converted == null ? null : (grade.converted ? 1 : 0), play_text: p.text, graded_at: new Date().toISOString(), play_id: p.id }
    : { status: 'voided', play_text: p.text, graded_at: new Date().toISOString(), play_id: p.id });
}

async function processGame(gid, s, row, live) {
  const g = games[gid] = games[gid] || { teams: teamsOf(s), seen: new Map(), pending: null, lastPredictedFor: null, closed: false, rows: {}, missed: 0 };
  g.row = row;
  const plays = allPlays(s);
  const out = { games: [row], predictions: [] };
  for (const p of plays) {
    const f = fp(p), prev = g.seen.get(p.id);
    if (prev === f) continue;
    g.seen.set(p.id, f);
    const grade = gradePlay(p);
    if (prev !== undefined) {
      // same play id, changed content (review, correction): regrade the row that was graded on it
      const r = Object.values(g.rows).find(x => x.play_id === p.id && x.status === 'graded');
      if (r && grade) { const before = `${r.actual_play}|${r.actual_fourth}|${r.actual_converted}`; gradeInto(r, p, grade, true); if (before !== `${r.actual_play}|${r.actual_fourth}|${r.actual_converted}`) { out.predictions.push(r); ledger({ type: 'regrade', ...r }); log(row.short_name, 'regraded on corrected play', p.id); } }
      continue;
    }
    if (!grade) continue; // timeout, penalty, kickoff, try: the situation may still be intact
    if (g.pending) {
      gradeInto(g.pending.row, p, grade, stateKeyOfStart(p) === g.pending.key);
      out.predictions.push(g.pending.row); ledger({ type: 'grade', ...g.pending.row }); g.pending = null;
    } else if (live && g.lastPredictedFor) { g.missed++; } // a scrimmage play arrived with no call standing for it
  }
  // Predict for the play after the newest play, once per newest play, only while live. Re-attempted on later polls
  // when the end state was missing or Jev failed (lastPredictedFor is set only after a successful call).
  const last = plays[plays.length - 1];
  if (live && last && !g.pending && g.lastPredictedFor !== last.id) {
    const st = nextState(last, g.teams, plays.slice(0, -1));
    if (st) {
      const base = baselinePredict(B, st);
      const jev = await askJev(st, hintsFrom(base));
      if (jev.error) { errors.jev++; log(row.short_name, 'jev error', jev.error); }
      else {
        g.lastPredictedFor = last.id;
        const row2 = { id: `${row.id}|${last.id}`, game_id: row.id, seq: Number(last.sequenceNumber) || plays.length, created_at: new Date().toISOString(),
          down: st.down, distance: st.distance, yte: st.yards_to_endzone, offense: st.offense, defense: st.defense, quarter: st.quarter, clock: st.clock, field_position: st.field_position,
          p_pass: jev.p_pass, jev_play: jev.play_type, play_conf: jev.play_conf, p_conv: jev.p_conv, jev_fourth: jev.fourth?.choice || null, jev_fourth_probs: jev.fourth ? JSON.stringify(jev.fourth.probabilities) : null,
          base_p_pass: base.p_pass, base_fourth: base.fourth ? JSON.stringify(base.fourth) : null, base_p_conv: base.p_conv,
          status: 'pending', model: jev.model || MODEL, latency_ms: jev.ms, state_json: JSON.stringify(st) };
        g.pending = { key: st.key, row: row2 }; g.rows[row2.id] = row2; out.predictions.push(row2); ledger({ type: 'predict', ...row2 });
        log(row.short_name, `${st.offense} ${st.down}&${st.distance} @ ${st.field_position} -> jev ${st.down === 4 ? jev.fourth?.choice : (jev.p_pass >= 0.5 ? 'pass' : 'run')} (p_pass ${jev.p_pass?.toFixed(2)}, conv ${jev.p_conv?.toFixed(2)}) ${jev.ms}ms`);
      }
    }
  }
  if (!live && g.pending) { const r = g.pending.row; r.status = 'voided'; r.graded_at = new Date().toISOString(); r.play_text = 'game over'; out.predictions.push(r); ledger({ type: 'void', ...r }); g.pending = null; }
  return out;
}

function stateSnapshot(replay) {
  const gs = Object.values(games).filter(g => g.row).map(g => g.row);
  const byGame = {}; const missedByGame = {}; let missed = 0;
  for (const g of Object.values(games)) { if (!g.row) continue; byGame[g.row.id] = Object.values(g.rows); missedByGame[g.row.id] = g.missed; missed += g.missed; }
  return { ...buildState(gs, byGame, { heartbeat: new Date().toISOString(), missed, missedByGame, errors }), replay: replay ? 1 : 0 };
}

// rehydrate rows for games already known to the Worker (poller restart mid-game)
async function rehydrate(ids) {
  try {
    const r = await fetch(`${WORKER}/api/rows?games=${ids.join(',')}`, { signal: AbortSignal.timeout(12000) }); if (!r.ok) return;
    const { rows } = await r.json(); let n = 0;
    for (const row of rows) { const g = games[row.game_id.replace(/-replay$/, '')] || games[row.game_id]; if (!g) continue; if (!g.rows[row.id]) { g.rows[row.id] = row; n++; } }
    if (n) log(`rehydrated ${n} rows from the Worker`);
  } catch (e) { log('rehydrate failed', e.message); }
}

if (REPLAY) {
  const full = JSON.parse(fs.readFileSync(path.join(dataDir, `summary-${REPLAY}.json`), 'utf8'));
  const plays = allPlays(full); const teams = teamsOf(full);
  const ev = { id: full.header.id, name: Object.values(teams).map(t => t.name).join(' at '), shortName: `${Object.values(teams).find(t => !t.home).abbr} @ ${Object.values(teams).find(t => t.home).abbr}`, competitions: full.header.competitions };
  log(`replaying ${ev.shortName}: ${plays.length} plays at ${SPEED}ms, ${BATCH} per tick`);
  for (let n = BATCH; n < plays.length + BATCH; n += BATCH) {
    const k = Math.min(n, plays.length);
    const partial = { header: full.header, drives: { previous: [{ id: 'r', plays: plays.slice(0, k) }] } };
    const lastP = plays[k - 1]; const live = k < plays.length;
    const row = { ...gameRow(ev, full, true), state: live ? 'in' : 'post', status: live ? 'In Progress (replay)' : 'Final (replay)', period: lastP.period?.number, clock: lastP.clock?.displayValue, home_score: lastP.homeScore, away_score: lastP.awayScore };
    const out = await processGame(row.id, partial, row, live);
    await push({ ...out, state: stateSnapshot(true) });
    await new Promise(r => setTimeout(r, SPEED));
  }
  log('replay done'); process.exit(0);
}

// ---- live loop ----
log('live poller up, worker', WORKER, 'ledger', ledgerPath);
const stopAt = new Date(); stopAt.setHours(23, 45, 0, 0);
let cycles = 0, rehydrated = false;
while (new Date() < stopAt) {
  const t0 = Date.now(); let anyLive = false;
  try {
    const sb = await scoreboard();
    if (!sb) errors.espn++;
    const events = sb?.events || [];
    const now = Date.now();
    const active = events.filter(e => { const st = e.status?.type?.state; const start = new Date(e.date).getTime(); return st === 'in' || (st === 'pre' && start - now < 30 * 60000 && start - now > -3 * 3600000) || (st === 'post' && games[e.id] && !games[e.id].closed); });
    anyLive = active.some(e => e.status?.type?.state === 'in');
    const batch = { games: [], predictions: [] };
    let idx = 0;
    const worker = async () => {
      while (idx < active.length) {
        const ev = active[idx++]; const st = ev.status?.type?.state;
        try {
          const s = st === 'pre' ? null : await summary(ev.id);
          if (st !== 'pre' && !s) errors.espn++;
          const row = gameRow(ev, s, false);
          if (!s) { batch.games.push(row); games[ev.id] = games[ev.id] || { teams: {}, seen: new Map(), pending: null, lastPredictedFor: null, closed: false, rows: {}, missed: 0 }; games[ev.id].row = row; continue; }
          const out = await processGame(ev.id, s, row, st === 'in');
          batch.games.push(...out.games); batch.predictions.push(...out.predictions);
          if (st === 'post') games[ev.id].closed = true;
        } catch (e) { errors.cycle++; log('process error', ev.shortName || ev.id, e.message); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(SUMMARY_CONCURRENCY, Math.max(active.length, 1)) }, worker));
    if (!rehydrated && active.some(e => e.status?.type?.state !== 'pre')) { rehydrated = true; await rehydrate(active.map(e => e.id)); }
    if (batch.games.length || batch.predictions.length || fs.existsSync(outboxPath)) await push({ ...batch, state: stateSnapshot(false) });
    if (!anyLive && cycles % 10 === 0) log(`idle: ${events.length} events on the board, ${active.length} active`);
  } catch (e) { errors.cycle++; log('cycle error', e.message); }
  cycles++;
  const wait = Math.max(0, (anyLive ? POLL_MS : IDLE_MS) - (Date.now() - t0));
  await new Promise(r => setTimeout(r, wait));
}
log('stop time reached'); process.exit(0);
