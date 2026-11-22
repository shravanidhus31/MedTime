// The weekly review's rules (fix 8, plan 6.4 / 6.5, Features 1 and 3). Pure functions, unit-tested
// (agent/__tests__/weekly_review.test.js); services/weeklyReviewService.js loads the data and acts.
//
// Feature 1 (change in how calls go): her own baseline = her first 4 weeks of calls; each part of
// the day is compared only with itself; a measure counts as changed when it is worse than her
// baseline by more than the margin (default 25%, the caregiver can widen it) AND by a minimum
// amount, in BOTH of the last two weeks. One bad week is reported as "not flagged yet".
// Feature 3 (sundowning): in the last 3 weeks, harder evenings (distress words, answers the agent
// couldn't follow, silences, missed doses) in all 3 weeks, at least 4 events, and clearly more than
// in the daytime → propose an earlier evening call.

const DAY = 24 * 3600 * 1000;
const BLOCKS = ['morning', 'afternoon', 'evening', 'night'];

// What each measure means in plain words, which direction is worse, and the smallest change that
// counts (so 0.1 → 0.2 "fillers per call" is not a "100% rise").
const METRICS = {
  clarificationCount: { label: 'needed things said again', unit: 'times per call', worse: 'higher', minAbs: 0.5 },
  fillersCount: { label: 'searched for words ("um", "you know")', unit: 'per call', worse: 'higher', minAbs: 0.5 },
  repeatedPhrasesCount: { label: 'repeated herself', unit: 'per call', worse: 'higher', minAbs: 0.5 },
  unclearTurns: { label: 'gave answers the assistant could not follow', unit: 'per call', worse: 'higher', minAbs: 0.5 },
  checkFails: { label: 'could not say which tablet she took', unit: 'per call', worse: 'higher', minAbs: 0.4 },
  turnsToConfirm: { label: 'needed more turns to confirm a dose', unit: 'turns', worse: 'higher', minAbs: 0.7 },
  turnLengthWords: { label: 'gave shorter answers', unit: 'words per answer', worse: 'lower', minAbs: 1.5 },
  latencyMs: { label: 'took longer to answer', unit: 'ms', worse: 'higher', minAbs: 400 },
};
// The weekly chat call (the speech-screening paper's measures, agent/languageMeasures.js). One call
// a week, so: her first 4 chats (at least 3) against each of the last two weeks' chat.
const CHAT_METRICS = {
  mtld: { label: 'used a narrower range of words (MTLD)', unit: '', worse: 'lower', minAbs: 5 },
  hdd: { label: 'used a narrower range of words (HD-D)', unit: '', worse: 'lower', minAbs: 0.03 },
  cttr: { label: 'used a narrower range of words (CTTR)', unit: '', worse: 'lower', minAbs: 0.3 },
  brunetW: { label: "used a narrower range of words (Brunet's index)", unit: '', worse: 'higher', minAbs: 0.4 },
  nounShare: { label: 'used fewer naming words (nouns)', unit: 'of words', worse: 'lower', minAbs: 0.03 },
  repeatedPhrasesCount: { label: 'repeated herself', unit: 'times', worse: 'higher', minAbs: 1 },
  fillersCount: { label: 'searched for words ("um", "you know")', unit: 'times', worse: 'higher', minAbs: 1 },
  wordCount: { label: 'said less', unit: 'words', worse: 'lower', minAbs: 15 },
  speechRateWpm: { label: 'spoke more slowly', unit: 'words a minute', worse: 'lower', minAbs: 15 },
  latencyMs: { label: 'took longer to start answering', unit: 'ms', worse: 'higher', minAbs: 400 },
};
const MIN_BASE_CALLS = 6; // calls in that part of the day during her first 4 weeks
const MIN_WEEK_CALLS = 2; // calls in that part of the day in each of the last two weeks

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 1) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

// Observation rows → one record per call: { callId, at, block, callType, m: { metric: value } }
function groupByCall(observations) {
  const calls = new Map();
  for (const o of observations || []) {
    const key = String(o.callId || `${o.timestamp}`);
    if (!calls.has(key)) calls.set(key, { callId: o.callId ? String(o.callId) : null, at: new Date(o.timestamp), block: o.timeOfDay, callType: o.callType, seeded: !!(o.metadata && o.metadata.seeded), m: {} });
    calls.get(key).m[o.metric] = o.value;
  }
  return [...calls.values()].sort((a, b) => a.at - b.at);
}

// Which window a call is in: 'week0' (last 7 days), 'week1' (the 7 before), 'base' (her first 4
// weeks, if before week1), or null.
function windowOf(at, ref, firstAt) {
  const t = new Date(at).getTime();
  const r = new Date(ref).getTime();
  if (t > r) return null;
  if (t > r - 7 * DAY) return 'week0';
  if (t > r - 14 * DAY) return 'week1';
  if (firstAt && t < new Date(firstAt).getTime() + 28 * DAY) return 'base';
  return null;
}

function isWorse(metric, base, value, margin, defs = METRICS) {
  const def = defs[metric];
  if (base === null || value === null) return false;
  const diff = def.worse === 'higher' ? value - base : base - value;
  return diff >= def.minAbs && diff > Math.abs(base) * margin;
}

// → { results: [{ block, metric, base, week1, week0, change: 'two_weeks'|'one_week'|'none' }], blocks: {block: {base, week1, week0, enough}}, firstAt, callCount }
function compareWithBaseline(calls, { ref = new Date(), margin = 0.25 } = {}) {
  const firstAt = calls.length ? calls[0].at : null;
  const byBlock = {};
  for (const b of BLOCKS) byBlock[b] = { base: [], week1: [], week0: [] };
  for (const c of calls) {
    const w = windowOf(c.at, ref, firstAt);
    if (w && byBlock[c.block]) byBlock[c.block][w].push(c);
  }
  const results = [];
  const blocks = {};
  for (const b of BLOCKS) {
    const g = byBlock[b];
    const enough = g.base.length >= MIN_BASE_CALLS && g.week1.length >= MIN_WEEK_CALLS && g.week0.length >= MIN_WEEK_CALLS;
    blocks[b] = { base: g.base.length, week1: g.week1.length, week0: g.week0.length, enough };
    if (!enough) continue;
    for (const metric of Object.keys(METRICS)) {
      const vals = (list) => list.map((c) => c.m[metric]).filter((v) => typeof v === 'number');
      const bv = vals(g.base); const v1 = vals(g.week1); const v0 = vals(g.week0);
      if (bv.length < 3 || v1.length < MIN_WEEK_CALLS || v0.length < MIN_WEEK_CALLS) continue;
      const base = mean(bv); const week1 = mean(v1); const week0 = mean(v0);
      const w1 = isWorse(metric, base, week1, margin);
      const w0 = isWorse(metric, base, week0, margin);
      results.push({ block: b, metric, base: round(base), week1: round(week1), week0: round(week0), change: w1 && w0 ? 'two_weeks' : w0 ? 'one_week' : 'none' });
    }
  }
  return { results, blocks, firstAt, callCount: calls.length };
}

// The weekly chat (Feature 1, the paper's measures): her first 4 weeks of chats (≥ 3) against the
// chat of each of the last two weeks. Results use block 'chat'.
function compareChat(chats, { ref = new Date(), margin = 0.25 } = {}) {
  const firstAt = chats.length ? chats[0].at : null;
  const g = { base: [], week1: [], week0: [] };
  for (const c of chats) { const w = windowOf(c.at, ref, firstAt); if (w) g[w].push(c); }
  const enough = g.base.length >= 3 && g.week1.length >= 1 && g.week0.length >= 1;
  const results = [];
  if (enough) {
    for (const metric of Object.keys(CHAT_METRICS)) {
      const vals = (list) => list.map((c) => c.m[metric]).filter((v) => typeof v === 'number');
      const bv = vals(g.base); const v1 = vals(g.week1); const v0 = vals(g.week0);
      if (bv.length < 3 || !v1.length || !v0.length) continue;
      const base = mean(bv); const week1 = mean(v1); const week0 = mean(v0);
      const w1 = isWorse(metric, base, week1, margin, CHAT_METRICS);
      const w0 = isWorse(metric, base, week0, margin, CHAT_METRICS);
      results.push({ block: 'chat', metric, base: round(base, 3), week1: round(week1, 3), week0: round(week0, 3), change: w1 && w0 ? 'two_weeks' : w0 ? 'one_week' : 'none' });
    }
  }
  return { results, enough, firstAt, counts: { base: g.base.length, week1: g.week1.length, week0: g.week0.length } };
}

// Feature 3. events: calls (distress words, ≥2 unclear answers or ≥2 silences) and missed doses
// ([{ at, block }]) over the last 3 weeks.
function detectSundowning(calls, missed = [], { ref = new Date() } = {}) {
  const r = new Date(ref).getTime();
  const weekOf = (at) => Math.floor((r - new Date(at).getTime()) / (7 * DAY)); // 0, 1, 2
  const events = [];
  for (const c of calls) {
    const hard = (c.m.sundowningAnxietyCount || 0) > 0 || (c.m.unclearTurns || 0) >= 2 || (c.m.silentTurns || 0) >= 2;
    if (hard) events.push({ at: c.at, block: c.block, kind: 'hard_call' });
  }
  for (const d of missed) events.push({ at: d.at, block: d.block, kind: 'missed_dose' });
  const recent = events.filter((e) => { const w = weekOf(e.at); return w >= 0 && w <= 2; });
  const evening = recent.filter((e) => e.block === 'evening' || e.block === 'night');
  const daytime = recent.filter((e) => e.block === 'morning' || e.block === 'afternoon');
  const weeks = new Set(evening.map((e) => weekOf(e.at)));
  const perWeek = [0, 1, 2].map((w) => evening.filter((e) => weekOf(e.at) === w).length);
  const detected = weeks.size >= 3 && evening.length >= 4 && evening.length >= 2 * Math.max(daytime.length, 1);
  return { detected, eveningEvents: evening.length, daytimeEvents: daytime.length, weeksWithEveningEvents: weeks.size, perWeek, missedEvening: evening.filter((e) => e.kind === 'missed_dose').length };
}

module.exports = { METRICS, CHAT_METRICS, compareChat, BLOCKS, MIN_BASE_CALLS, MIN_WEEK_CALLS, groupByCall, windowOf, isWorse, compareWithBaseline, detectSundowning, mean, round, DAY };
