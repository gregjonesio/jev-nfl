// One-off patch applied on launch night (kept for the record; safe to re-run, each edit is idempotent).
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const rw = (rel, fn) => { const p = new URL(rel, root); const before = fs.readFileSync(p, 'utf8'); const after = fn(before); fs.writeFileSync(p, after); return after; };

const e = rw('src/espn.mjs', s => s.replace(
  "  const seen = new Set(); const out = [];\n  for (const d of drives) for (const p of d.plays || []) { if (seen.has(p.id)) continue; seen.add(p.id); out.push({ ...p, driveId: d.id }); }\n  out.sort((a, b) => (Number(a.sequenceNumber) || 0) - (Number(b.sequenceNumber) || 0));\n  return out;",
  "  const byId = new Map(); let i = 0;\n  for (const d of drives) for (const p of d.plays || []) byId.set(p.id, { ...p, driveId: d.id, _idx: i++ }); // later copy (current drive) wins\n  const out = [...byId.values()];\n  out.sort((a, b) => ((Number(a.sequenceNumber) || a._idx) - (Number(b.sequenceNumber) || b._idx)));\n  return out;"));

const p = rw('src/page.html', s => s
  .replace('Every call is timestamped before the next play is reported by the feed and graded against what actually happened.', 'Each call is made from the latest play visible in the feed, timestamped before the poller sees the outcome, and graded against what actually happened.')
  .replace('so a call is made before the next play is reported, not always before the real snap.', 'so a call is made from the latest play the poller has seen, before it sees the outcome, and not always before the real snap. When several plays arrive in one poll only the first is graded and the rest are counted as missed.')
  .replace('<h1>Jev Calls the Play <span id="live" class="live off">connecting</span></h1>', '<h1>Jev Calls the Play <span id="live" class="live off">connecting</span> <span id="hb" class="live off" style="display:none"></span></h1>')
  .replace('<div class="row muted"><span>Pending / voided</span><b>${t.pending} / ${t.voided}</b></div></div>`;', '<div class="row muted"><span>Pending / voided / missed</span><b>${t.pending} / ${t.voided} / ${d_missed}</b></div></div>`;')
  .replace('function cards(t) {', 'let d_missed = 0;\nfunction cards(t) {')
  .replace('<div class="score">${g.away_abbr} ${g.away_score ?? 0} – ${g.home_abbr} ${g.home_score ?? 0}</div>', '<div class="score">${esc(g.away_abbr)} ${g.away_score ?? 0} – ${esc(g.home_abbr)} ${g.home_score ?? 0}</div>')
  .replace("    const anyLive = d.games.some(g => g.state === 'in');", "    const anyLive = d.games.some(g => g.state === 'in'); d_missed = d.missed || 0;\n    const age = d.heartbeat ? Math.round((Date.now() - new Date(d.heartbeat).getTime()) / 1000) : null; const hb = $('#hb'); if (anyLive && age != null) { hb.style.display = ''; hb.textContent = age > 90 ? 'feed stale ' + age + 's' : 'updated ' + age + 's ago'; hb.className = 'live' + (age > 90 ? ' off' : ''); } else hb.style.display = 'none';")
  .replace('refresh(); setInterval(refresh, 10000);', "refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 30000); document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });"));

const r = rw('README.md', s => s.replace('Every call is timestamped before the next play is reported by the feed (which runs some seconds behind the stadium) and graded against what the coach actually did.', 'Each call is made from the latest play visible in the ESPN feed (which runs some seconds behind the stadium), timestamped before the poller sees the outcome, and graded against what the coach actually did. When several plays arrive in one poll only the first is graded and the rest are counted as missed.'));

console.log('patches', [e.includes('later copy'), p.includes('30000'), p.includes('d_missed'), p.includes('feed stale'), p.includes('esc(g.away_abbr)'), p.includes('latest play visible'), r.includes('latest play visible')].join(','));
