// Jev client and the pre-snap questions. Key from secrets\jev\.env (API_KEY=...).
import fs from 'node:fs';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const MODEL = 'jev-1.13.0'; // pinned on purpose: a new version is a new forecaster

let KEY = null;
export function loadKey(path = 'C:/Users/grego/secrets/jev/.env') {
  const raw = fs.readFileSync(path, 'utf8');
  const m = raw.match(/^\s*(?:API_KEY|TYPESAFE_API_KEY)\s*=\s*(.+)\s*$/m);
  if (!m) throw new Error('no API_KEY in ' + path);
  KEY = m[1].trim();
}

export function questionsFor(st) {
  const q = {
    play_type: {
      type: 'choice',
      instructions: `NFL game, ${st.offense} has the ball against ${st.defense}. It is ${nth(st.down)} and ${st.distance} at ${st.field_position}, quarter ${st.quarter}, ${st.clock} on the clock, ${st.offense} ${st.score_diff >= 0 ? 'leads by ' + st.score_diff : 'trails by ' + (-st.score_diff)}. Before the snap: what kind of play will the offense run?`,
      criteria: { pass: 'The quarterback drops back to pass (counts sacks and scrambles as pass plays)', run: 'A designed running play' },
    },
    first_down: {
      type: 'noul',
      instructions: 'This play will gain a first down or score a touchdown.',
    },
  };
  if (st.down === 4) q.fourth_down = {
    type: 'choice',
    instructions: `It is 4th down. What will the head coach decide to do?`,
    criteria: { go_for_it: 'Run an offensive play to try to convert', punt: 'Punt the ball away', field_goal: 'Attempt a field goal' },
  };
  return q;
}
const nth = (d) => ['', '1st', '2nd', '3rd', '4th'][d] || d + 'th';

export function stateForJev(st) {
  const { key, ...rest } = st; return rest;
}

export async function askJev(st, hints = null, attempt = 0) {
  if (!KEY) loadKey();
  const t0 = Date.now();
  try {
    const res = await fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ state: { ...stateForJev(st), ...(hints || {}) }, questions: questionsFor(st), model: MODEL }), signal: AbortSignal.timeout(8000) });
    const ms = Date.now() - t0;
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await new Promise(r => setTimeout(r, 1200 * (attempt + 1))); return askJev(st, hints, attempt + 1); }
    if (!res.ok) return { error: `HTTP ${res.status}`, body: (await res.text()).slice(0, 200), ms };
    const j = await res.json();
    const a = j.answers || {};
    return {
      ms, model: j.model, input_tokens: j.usage?.input_tokens,
      p_pass: a.play_type?.probabilities?.pass ?? null,
      play_type: a.play_type?.choice ?? null,
      play_conf: a.play_type?.confidence ?? null,
      p_conv: a.first_down?.noul ?? null,
      fourth: a.fourth_down ? { choice: a.fourth_down.choice, probabilities: a.fourth_down.probabilities, confidence: a.fourth_down.confidence } : null,
    };
  } catch (e) {
    if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); return askJev(st, hints, attempt + 1); }
    return { error: String(e.message || e).slice(0, 200), ms: Date.now() - t0 };
  }
}

// League tendency rates from the baseline, passed to Jev as part of the state (backtest 9/19/26: lifts run/pass 61.5->64.6%, 4th down 56.8->64.9%).
export function hintsFrom(base) {
  const h = { league_pass_rate_in_similar_situations: +base.p_pass.toFixed(2), league_first_down_rate_in_similar_situations: +base.p_conv.toFixed(2) };
  if (base.fourth) h.league_coach_choice_rates_in_similar_4th_downs = Object.fromEntries(Object.entries(base.fourth).map(([k, v]) => [k, +v.toFixed(2)]));
  return h;
}
