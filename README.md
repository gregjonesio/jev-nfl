# Jev Calls the Play

Before every NFL snap, [Jev](https://typesafe.ai) (TypeSafe's System One model, a decision-only model that cannot write text) calls **run or pass** and, on fourth down, **go, punt or field goal**. Each call is made from the latest play visible in the ESPN feed (which runs some seconds behind the stadium), timestamped before the poller sees the outcome, and graded against what the coach actually did. When several plays arrive in one poll only the first is graded and the rest are counted as missed. A plain league-tendency table is the baseline.

Live: https://jev-nfl.gregjones.io (add `?replay=1` to see a replayed past game)

## How it works

1. `src/live.mjs` polls ESPN's public scoreboard every 10 seconds during games (60 seconds when idle).
2. After each play, `src/espn.mjs` builds the pre-snap situation for the next play from the play's end state: down, distance, yards to the end zone, field position, score, quarter, clock, last three plays.
3. `src/baseline.mjs` looks up league tendency rates for that situation (pass rate; fourth-down go/punt/FG rates), built from earlier weeks by `src/build-baseline.mjs`.
4. `src/jev.mjs` sends the situation plus those rates to Jev with three typed questions: `play_type` (choice pass/run), `first_down` (probability), and on fourth down `fourth_down` (choice go/punt/field goal). Model pinned to `jev-1.13.0`.
5. When the next scrimmage play arrives, the call is graded if the play's start state matches the predicted situation, and voided if a penalty or timeout changed it. Sacks and scrambles count as pass plays.
6. Rows are pushed to a Cloudflare Worker (`src/worker.js`) backed by D1, which serves the page (`src/page.html`), a JSON API (`/api/state`) and a CSV ledger (`/api/ledger.csv`). The poller also appends a local JSONL ledger in `data/`.

## Backtest (2026-09-19, four held-out games, 540 plays, 37 fourth downs)

| | Tendency table | Jev (with tendencies in state) | Trivial rule |
|---|---|---|---|
| Run/pass accuracy | 65.0% | 64.6% | always pass 60.4% |
| Fourth-down accuracy | 62.2% | 64.9% | always punt 51.4% |
| First-down Brier (lower better) | 0.192 | 0.204 | base rate 0.215 |

Without the tendency rates in its state, Jev scored 61.5% and 56.8%. Jev is more willing to call "go for it" than coaches are.

## Reliability notes

- Failed pushes to the Worker go to an on-disk outbox (`data/outbox-<day>.jsonl`) and are retried oldest-first before every later push, so a Worker outage loses nothing.
- Database writes are monotonic: a row is inserted once, only its outcome columns are ever updated, a graded or voided row never goes back to pending, and a newer pending call supersedes older pending rows for the same game (poller restarts).
- The poller computes the page state from memory and sends it with each batch, so page views read one snapshot row and the Worker never rescans the table. After a restart the poller rehydrates existing rows from `/api/rows`.
- ESPN and Jev calls time out at 8 seconds, ingest at 12. Each cycle and each game is wrapped in its own error handling.
- If ESPN corrects a play after review (same id, changed content), the row graded on it is regraded. A scrimmage play that arrives while no call is standing is counted as missed and shown on the page.
- The page polls every 30 seconds, pauses when the tab is hidden, and shows a heartbeat badge that turns to "feed stale" if the poller has not reported for 90 seconds.
- Limits: calls use the prior play's ending clock rather than the true pre-snap clock; the page runs on Cloudflare's free tier; there is no alerting if the poller dies beyond the heartbeat badge.

## Run

    node src/build-baseline.mjs          # rebuild data/baseline.json from saved summaries (holds out 4 games)
    node src/backtest.mjs                # replay held-out games through Jev, print scores
    node src/live.mjs                    # live poller (or run-live.cmd; a scheduled task runs it daily at 9:40 AM PT)
    node src/live.mjs --replay <espnEventId> --speed 900   # replay a saved game into the Worker as a demo
    node src/live.mjs --clear-replay
    npx wrangler deploy                  # deploy the Worker

Secrets: Jev key in `secrets\jev\.env` (`API_KEY=`), Worker ingest token in `secrets\jev-nfl\.env` (`INGEST_TOKEN=`, also set as a Worker secret). Neither is in the repo.

No wagering. Not affiliated with the NFL, ESPN or TypeSafe.
