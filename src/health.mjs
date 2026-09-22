// Outcome health for the live poller. The three failures in the first three days (ESPN 403 on our User-Agent, late
// games with no calls, the poller dying at 10:00) all logged zero errors, so these checks look at results, not errors:
//   board_empty         no scoreboard with any events for 30 min (in season the board always lists the week's games)
//   live_game_no_calls  a live game kept producing scrimmage plays with no successful call standing
//   push_failing        the Worker has been unreachable for 15 min
// A breach suppresses success heartbeats for 24 hours, so a failure that clears on its own (or is erased by the
// nightly restart) still goes stale on the once-a-day dead-man check instead of vanishing. Pure logic, tested.
export const PLAYS_WITHOUT_CALL = 8;
export const BOARD_EMPTY_MS = 30 * 60000;
export const PUSH_FAILING_MS = 15 * 60000;
export const STICKY_MS = 24 * 3600000;
export const BEAT_EVERY_MS = 30 * 60000;

export function createHealth(now) { return { startedAt: now, lastBoardOkAt: null, pushFailingSince: null }; }
export function noteBoard(h, eventCount, now) { if (eventCount > 0) h.lastBoardOkAt = now; }
export function notePush(h, ok, now) { if (ok) h.pushFailingSince = null; else if (h.pushFailingSince == null) h.pushFailingSince = now; }

// games: [{ name, live, playsSinceCall }]. Most specific breach first; it becomes the heartbeat's error_code.
export function breaches(h, games, now) {
  const out = [];
  for (const g of games) if (g.live && g.playsSinceCall >= PLAYS_WITHOUT_CALL) out.push({ code: 'live_game_no_calls', detail: `${g.name}: ${g.playsSinceCall} plays, no call` });
  if (now - (h.lastBoardOkAt ?? h.startedAt) >= BOARD_EMPTY_MS) out.push({ code: 'board_empty', detail: 'no events on the scoreboard for 30 min' });
  if (h.pushFailingSince != null && now - h.pushFailingSince >= PUSH_FAILING_MS) out.push({ code: 'push_failing', detail: 'Worker unreachable for 15 min' });
  return out;
}

// sticky: { code, at } of the last breach seen (persisted across restarts), or null.
export function verdict(current, sticky, now) {
  if (current.length) return { status: 'failed', error_code: current[0].code, sticky: { code: current[0].code, at: now } };
  if (sticky && now - sticky.at < STICKY_MS) return { status: 'failed', error_code: sticky.code, sticky };
  return { status: 'success', sticky: null };
}
