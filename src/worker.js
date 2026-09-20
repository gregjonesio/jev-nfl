// Cloudflare Worker: ingest endpoint for the poller, JSON API for the page, CSV ledger export, and the page itself.
// The poller computes the page state itself and sends it with each batch, so page views cost one D1 row read and
// the Worker never rescans the predictions table during a game. Writes are monotonic: a graded or voided row is
// never reverted to pending by a late or duplicate payload.
import page from './page.html';
import { buildState } from './tally.mjs';

const GAME_COLS = ['id', 'name', 'short_name', 'date', 'status', 'state', 'home_abbr', 'away_abbr', 'home_score', 'away_score', 'period', 'clock', 'replay', 'updated_at'];
const PRED_COLS = ['id', 'game_id', 'seq', 'created_at', 'down', 'distance', 'yte', 'offense', 'defense', 'quarter', 'clock', 'field_position', 'p_pass', 'jev_play', 'play_conf', 'p_conv', 'jev_fourth', 'jev_fourth_probs', 'base_p_pass', 'base_fourth', 'base_p_conv', 'status', 'actual_play', 'actual_fourth', 'actual_converted', 'play_text', 'graded_at', 'play_id', 'model', 'latency_ms', 'state_json'];
const OUTCOME_COLS = ['status', 'actual_play', 'actual_fourth', 'actual_converted', 'play_text', 'graded_at', 'play_id'];
const SEC = { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...SEC } });
const MAX_BODY = 2_000_000, MAX_STR = 4000;

const norm = (v) => v === undefined ? null : (typeof v === 'object' && v !== null ? JSON.stringify(v) : (typeof v === 'boolean' ? (v ? 1 : 0) : (typeof v === 'string' && v.length > MAX_STR ? v.slice(0, MAX_STR) : v)));
const upsertGame = (db, g) => db.prepare(`INSERT OR REPLACE INTO games (${GAME_COLS.join(',')}) VALUES (${GAME_COLS.map(() => '?').join(',')})`).bind(...GAME_COLS.map(c => norm(g[c])));
// Insert if new; on conflict update only the outcome columns, and only forward: pending -> graded/voided, graded -> graded (correction). Never back to pending.
const upsertPred = (db, p) => db.prepare(`INSERT INTO predictions (${PRED_COLS.join(',')}) VALUES (${PRED_COLS.map(() => '?').join(',')})
  ON CONFLICT(id) DO UPDATE SET ${OUTCOME_COLS.map(c => `${c}=excluded.${c}`).join(', ')}
  WHERE excluded.status <> 'pending' AND NOT (predictions.status = 'graded' AND excluded.status = 'voided')`).bind(...PRED_COLS.map(c => norm(p[c])));
const validRow = (p) => p && typeof p.id === 'string' && p.id.length < 120 && typeof p.game_id === 'string' && ['pending', 'graded', 'voided'].includes(p.status);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST' } });

    if (url.pathname === '/ingest' && req.method === 'POST') {
      if (req.headers.get('authorization') !== `Bearer ${env.INGEST_TOKEN}`) return json({ error: 'unauthorized' }, 401);
      if (Number(req.headers.get('content-length') || 0) > MAX_BODY) return json({ error: 'too large' }, 413);
      let body; try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      if (!body || typeof body !== 'object') return json({ error: 'bad body' }, 400);
      const games = Array.isArray(body.games) ? body.games.filter(g => g && typeof g.id === 'string') : [];
      const preds = Array.isArray(body.predictions) ? body.predictions.filter(validRow) : [];
      const stmts = [];
      for (const g of games) stmts.push(upsertGame(env.DB, { ...g, updated_at: new Date().toISOString() }));
      for (const p of preds) {
        stmts.push(upsertPred(env.DB, p));
        // a newer pending call supersedes any older pending call for the same game (poller restart, missed grade)
        if (p.status === 'pending') stmts.push(env.DB.prepare("UPDATE predictions SET status='voided', graded_at=?, play_text='superseded' WHERE game_id=? AND status='pending' AND id<>? AND COALESCE(seq,0) < ?").bind(new Date().toISOString(), p.game_id, p.id, Number(p.seq) || 0));
      }
      if (body.delete_replay) stmts.push(env.DB.prepare('DELETE FROM predictions WHERE game_id IN (SELECT id FROM games WHERE replay=1)'), env.DB.prepare('DELETE FROM games WHERE replay=1'), env.DB.prepare("DELETE FROM snapshots WHERE id='replay'"));
      if (body.state && typeof body.state === 'object') { const key = body.state.replay ? 'replay' : 'live'; stmts.push(env.DB.prepare('INSERT OR REPLACE INTO snapshots (id, json, updated_at) VALUES (?, ?, ?)').bind(key, JSON.stringify(body.state).slice(0, 900000), new Date().toISOString())); memo[key] = null; }
      for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
      return json({ ok: true, games: games.length, predictions: preds.length });
    }

    if (url.pathname === '/api/state') {
      const key = url.searchParams.get('replay') === '1' ? 'replay' : 'live';
      const m = memo[key];
      if (m && Date.now() - m.at < MEMO_MS) return new Response(m.body, { headers: { 'content-type': 'application/json; charset=utf-8', ...SEC } });
      const row = await env.DB.prepare('SELECT json FROM snapshots WHERE id=?').bind(key).first();
      const body = row?.json || JSON.stringify(buildState([], {}));
      memo[key] = { at: Date.now(), body };
      return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', ...SEC } });
    }

    // rows for the poller to rehydrate after a restart (public data, small)
    if (url.pathname === '/api/rows') {
      const ids = (url.searchParams.get('games') || '').split(',').filter(Boolean).slice(0, 20);
      if (!ids.length) return json({ rows: [] });
      const rows = (await env.DB.prepare(`SELECT * FROM predictions WHERE game_id IN (${ids.map(() => '?').join(',')}) ORDER BY game_id, seq`).bind(...ids).all()).results;
      return json({ rows });
    }

    if (url.pathname === '/api/ledger.csv') {
      const rows = (await env.DB.prepare('SELECT p.*, g.short_name FROM predictions p JOIN games g ON g.id=p.game_id WHERE g.replay=0 ORDER BY p.created_at').all()).results;
      const cols = ['id', 'short_name', 'created_at', 'graded_at', 'quarter', 'clock', 'offense', 'defense', 'down', 'distance', 'yte', 'field_position', 'p_pass', 'jev_play', 'p_conv', 'jev_fourth', 'jev_fourth_probs', 'base_p_pass', 'base_fourth', 'base_p_conv', 'status', 'actual_play', 'actual_fourth', 'actual_converted', 'play_text', 'model', 'latency_ms'];
      const esc = v => { if (v == null) return ''; let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const csv = [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
      return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="jev-nfl-ledger.csv"', 'cache-control': 'public, max-age=120', 'access-control-allow-origin': '*' } });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:" } });
    return json({ error: 'not found' }, 404);
  },
};
const memo = { live: null, replay: null }; // per-isolate cache
const MEMO_MS = 5000;
