// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealth, noteBoard, notePush, breaches, verdict, PLAYS_WITHOUT_CALL, BOARD_EMPTY_MS, PUSH_FAILING_MS, STICKY_MS } from '../src/health.mjs';

const T0 = Date.UTC(2026, 8, 27, 16, 40);
const min = 60000;

test('a healthy idle day is a success', () => {
  const h = createHealth(T0); noteBoard(h, 16, T0 + 5 * min);
  const v = verdict(breaches(h, [], T0 + 30 * min), null, T0 + 30 * min);
  assert.equal(v.status, 'success'); assert.equal(v.sticky, null);
});

test('an empty board for 30 minutes fails (the 9/20 ESPN 403)', () => {
  const h = createHealth(T0); noteBoard(h, 0, T0 + 10 * min);
  assert.deepEqual(breaches(h, [], T0 + BOARD_EMPTY_MS - 1), []);
  assert.equal(breaches(h, [], T0 + BOARD_EMPTY_MS)[0].code, 'board_empty');
});

test('a live game producing plays with no calls fails (the 9/20 placeholder-teams bug)', () => {
  const h = createHealth(T0); noteBoard(h, 16, T0);
  const g = (n, live = true) => [{ name: 'NYG @ LAR', live, playsSinceCall: n }];
  assert.deepEqual(breaches(h, g(PLAYS_WITHOUT_CALL - 1), T0 + min), []);
  assert.equal(breaches(h, g(PLAYS_WITHOUT_CALL), T0 + min)[0].code, 'live_game_no_calls');
  assert.deepEqual(breaches(h, g(PLAYS_WITHOUT_CALL, false), T0 + min), [], 'a finished game is not a breach');
});

test('the Worker unreachable for 15 minutes fails; one success clears it', () => {
  const h = createHealth(T0); noteBoard(h, 16, T0);
  notePush(h, false, T0); notePush(h, false, T0 + 10 * min);
  assert.equal(breaches(h, [], T0 + PUSH_FAILING_MS)[0].code, 'push_failing');
  notePush(h, true, T0 + PUSH_FAILING_MS);
  assert.deepEqual(breaches(h, [], T0 + PUSH_FAILING_MS + min), []);
});

test('a breach keeps success off the monitor for 24 hours, across a restart', () => {
  const h = createHealth(T0); noteBoard(h, 16, T0);
  const first = verdict([{ code: 'live_game_no_calls' }], null, T0);
  assert.equal(first.status, 'failed');
  // the condition clears (or the poller restarts the next morning with clean memory): still failed, same reason
  const later = verdict([], first.sticky, T0 + STICKY_MS - 1);
  assert.deepEqual([later.status, later.error_code], ['failed', 'live_game_no_calls']);
  const after = verdict([], first.sticky, T0 + STICKY_MS);
  assert.deepEqual([after.status, after.sticky], ['success', null]);
});

test('the most specific breach names the error code', () => {
  const h = createHealth(T0); notePush(h, false, T0);
  const b = breaches(h, [{ name: 'X', live: true, playsSinceCall: 20 }], T0 + BOARD_EMPTY_MS);
  assert.deepEqual(b.map(x => x.code), ['live_game_no_calls', 'board_empty', 'push_failing']);
});
