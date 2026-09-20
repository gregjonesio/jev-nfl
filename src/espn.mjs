// ESPN feed helpers: fetch scoreboard/summary, flatten plays, derive the pre-snap state for the NEXT play, grade a play.
const UA = { 'User-Agent': 'jev-nfl/0.1 (gregoryalanjones@gmail.com)' };
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const TIMEOUT_MS = 8000;

export async function getJSON(url, attempt = 0) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if ((r.status === 429 || r.status >= 500) && attempt < 3) { await new Promise(x => setTimeout(x, 1500 * (attempt + 1))); return getJSON(url, attempt + 1); }
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { if (attempt < 2) { await new Promise(x => setTimeout(x, 1000)); return getJSON(url, attempt + 1); } return null; }
}
export const scoreboard = (q = '') => getJSON(`${BASE}/scoreboard${q}`);
export const summary = (eventId) => getJSON(`${BASE}/summary?event=${eventId}`);

export function teamsOf(s) {
  const comps = s.header?.competitions?.[0]?.competitors || [];
  const byId = {};
  for (const c of comps) byId[c.id] = { id: c.id, abbr: c.team.abbreviation, name: c.team.displayName, home: c.homeAway === 'home', color: c.team.color, logo: c.team.logos?.[0]?.href };
  return byId;
}

// All plays in feed order (previous drives then current drive), deduped by id, ordered by sequenceNumber.
export function allPlays(s) {
  const drives = [...(s.drives?.previous || []), ...(s.drives?.current ? [s.drives.current] : [])];
  const byId = new Map(); let i = 0;
  for (const d of drives) for (const p of d.plays || []) byId.set(p.id, { ...p, driveId: d.id, _idx: i++ }); // later copy (current drive) wins
  const out = [...byId.values()];
  out.sort((a, b) => ((Number(a.sequenceNumber) || a._idx) - (Number(b.sequenceNumber) || b._idx)));
  return out;
}

const clockSeconds = (disp) => { const m = /^(\d+):(\d+)$/.exec(disp || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// Classify what actually happened. Returns {play_type, fourth_decision, converted} or null for non-plays.
export function gradePlay(p) {
  const t = p.type?.text || '', txt = p.text || '';
  if (/Kickoff|Extra Point|Two.Point|Timeout|End Period|End of Half|End of Game|Two-minute|Penalty/i.test(t)) return null;
  let play_type = null, fourth = null;
  if (/Punt/i.test(t)) fourth = 'punt';
  else if (/Field Goal/i.test(t)) fourth = 'field_goal';
  else if (/Pass|Sack|Interception/i.test(t)) play_type = 'pass';
  else if (/Rush/i.test(t)) play_type = /scramble/i.test(txt) ? 'pass' : 'run';
  else if (/Fumble/i.test(t)) play_type = /\bpass\b|sacked|scramble/i.test(txt) ? 'pass' : (/\brush|\bup the middle|\bleft end|\bright end|\bleft tackle|\bright tackle|\bleft guard|\bright guard|\bkneel/i.test(txt) ? 'run' : null);
  else if (/Touchdown|Safety/i.test(t)) play_type = /\bpass\b|sacked/i.test(txt) ? 'pass' : (/scramble/i.test(txt) ? 'pass' : (/\brush|\bup the middle|\bleft end|\bright end|\bleft tackle|\bright tackle|\bleft guard|\bright guard/i.test(txt) ? 'run' : null));
  if (!play_type && !fourth) return null;
  if (play_type && p.start?.down === 4) fourth = 'go_for_it';
  const sameTeam = p.end?.team?.id && p.start?.team?.id && p.end.team.id === p.start.team.id;
  const td = !!p.scoringPlay && !p.isTurnover && /touchdown/i.test(txt) && !/defensive|intercept|fumble return/i.test(txt);
  const converted = play_type ? ((sameTeam && p.end?.down === 1) || td) : null;
  return { play_type, fourth_decision: fourth, converted };
}

// True when the play that follows `p` cannot be a scrimmage play (kickoff or try comes next).
export function nextIsNotScrimmage(p) {
  const t = p.type?.text || '';
  if (p.scoringPlay) return true;                       // touchdown, field goal, safety -> try or kickoff next
  if (/Extra Point|Two.Point|End of Half|End of Game/i.test(t)) return true;
  return false;
}

// Pre-snap state for the play that follows `p` (using p.end), or null when the next play is not a scrimmage play.
export function nextState(p, teams, priorPlays) {
  if (nextIsNotScrimmage(p)) return null;
  const e = p.end; if (!e || !e.down || e.down < 1 || e.down > 4 || !e.team?.id || e.yardsToEndzone == null || e.yardsToEndzone < 1 || e.yardsToEndzone > 99) return null;
  const off = teams[e.team.id]; if (!off) return null;
  const def = Object.values(teams).find(t => t.id !== off.id);
  const offScore = off.home ? p.homeScore : p.awayScore, defScore = off.home ? p.awayScore : p.homeScore;
  const q = p.period?.number || 1, secs = clockSeconds(p.clock?.displayValue);
  const secsInHalf = secs == null ? null : (q === 1 || q === 3 ? secs + 900 : secs);
  const last = priorPlays.slice(-3).map(x => x.text).filter(Boolean);
  return {
    key: `${e.team.id}|${e.down}|${e.distance}|${e.yardsToEndzone}`,
    offense: off.abbr, defense: def?.abbr, offense_is_home: off.home,
    quarter: q, clock: p.clock?.displayValue || null, seconds_left_in_half: secsInHalf,
    down: e.down, distance: e.distance, yards_to_endzone: e.yardsToEndzone, field_position: e.possessionText || null,
    score_offense: offScore, score_defense: defScore, score_diff: offScore - defScore,
    two_minute_drill: secsInHalf != null && secsInHalf <= 120,
    last_plays: last,
  };
}

export const stateKeyOfStart = (p) => p.start?.team?.id && p.start.down ? `${p.start.team.id}|${p.start.down}|${p.start.distance}|${p.start.yardsToEndzone}` : null;
