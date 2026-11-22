// Offline tests for the orchestrator (A2.4) and POST /agent/turn. No database, no LLM.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const orch = require('./orchestrator');
const { keywordScreen, setSafetyScreen } = require('./safety');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const realScreen = keywordScreen;

let alerts;
test.beforeEach(() => {
  orch._reset();
  alerts = [];
  orch.setEmergencyHandler(async (session, verdict) => alerts.push(verdict.category));
  // A simple flow: greets, then echoes what it heard and keeps listening.
  orch.registerFlow('echo', {
    start: async () => [{ type: 'play', lineId: 'greet' }, { type: 'listen' }],
    turn: async (session, input) => {
      session.state.heard = (session.state.heard || 0) + 1;
      return [{ type: 'neutral', text: `heard: ${input.transcript || input.dtmf}` }, { type: 'listen' }];
    },
  });
});

const start = (opts = {}) => orch.startSession({ flow: 'echo', patientId: 'p1', ...opts });

test('a session starts with the flow\'s first actions and a random id', async () => {
  const a = await start();
  const b = await start();
  assert.deepEqual(a.actions, [{ type: 'play', lineId: 'greet' }, { type: 'listen' }]);
  assert.match(a.sessionId, /^[0-9a-f-]{36}$/);
  assert.notEqual(a.sessionId, b.sessionId);
});

test('a final transcript goes to the flow', async () => {
  const { sessionId } = await start();
  const r = await orch.handleTurn({ sessionId, transcript: 'yes I took it', isFinal: true });
  assert.deepEqual(r.actions, [{ type: 'neutral', text: 'heard: yes I took it' }, { type: 'listen' }]);
});

test('a partial transcript only gets the safety check', async () => {
  const { sessionId } = await start();
  const r = await orch.handleTurn({ sessionId, transcript: 'yes I', isFinal: false });
  assert.deepEqual(r.actions, []);
  assert.equal(orch.getSession(sessionId).state.heard, undefined);
});

test('a red flag in a PARTIAL transcript skips the flow: neutral voice, caregiver alert, keep listening', async () => {
  const { sessionId } = await start();
  const r = await orch.handleTurn({ sessionId, transcript: 'oh I fell in the', isFinal: false });
  assert.equal(r.emergency, 'fall');
  assert.equal(r.actions[0].type, 'neutral');
  assert.match(r.actions[0].text, /calling your family/);
  assert.equal(r.actions[1].type, 'listen');
  assert.equal(orch.getSession(sessionId).state.heard, undefined);
  await sleep(10);
  assert.deepEqual(alerts, ['fall']);
});

test('keypad 9 is an emergency at any moment; the family is alerted once per kind of emergency', async () => {
  const { sessionId } = await start();
  const r1 = await orch.handleTurn({ sessionId, dtmf: '9' });
  const r2 = await orch.handleTurn({ sessionId, transcript: 'my chest hurts', isFinal: true });
  const r3 = await orch.handleTurn({ sessionId, transcript: 'my chest still hurts', isFinal: true });
  assert.equal(r1.emergency, 'help_key');
  assert.equal(r2.emergency, 'chest_pain');
  assert.equal(r3.emergency, undefined); // same red flag again: reassured, not re-alerted
  assert.equal(r3.inEmergency, 'chest_pain');
  await sleep(10);
  assert.deepEqual(alerts, ['help_key', 'chest_pain']);
});

test('after a red flag the call stays in emergency mode: the flow never runs again (live voice test)', async () => {
  const { sessionId } = await start();
  const r1 = await orch.handleTurn({ sessionId, transcript: 'I have fallen down', isFinal: true });
  assert.equal(r1.emergency, 'fall');
  const r2 = await orch.handleTurn({ sessionId, transcript: 'Okay, bye.', isFinal: true });
  assert.equal(r2.actions[0].type, 'neutral');
  assert.equal(r2.actions[0].text, orch.STAY_TEXT);
  assert.equal(r2.actions[1].type, 'listen');
  assert.ok(!r2.actions.some((a) => /heard:/.test(a.text || '')), 'the flow must not answer after a red flag');
  assert.equal(r2.emergency, undefined);
  await sleep(10);
  assert.deepEqual(alerts, ['fall']);
});

test('the stand-in screen catches the PRD red flags and leaves normal replies alone', async () => {
  const flagged = {
    'I fell down in the bathroom': 'fall',
    'there is a pain in my chest': 'chest_pain',
    "I can't breathe properly": 'breathing',
    'I think I took it twice': 'extra_pills',
    'I want to end my life': 'self_harm',
    'a man called asking for my OTP': 'scam',
    'main gir gayi': 'fall',
  };
  for (const [text, category] of Object.entries(flagged)) {
    const v = await realScreen(text);
    assert.equal(v.verdict, 'redflag', text);
    assert.equal(v.category, category, text);
  }
  for (const text of ['Yes I took the white one', 'I took both pills with breakfast', 'Where is my pillbox?', 'I feel fine today']) {
    assert.equal((await realScreen(text)).verdict, 'ok', text);
  }
});

test('a slow flow gets a hold line and wait; the next empty turn collects the answer', async () => {
  orch.registerFlow('slow', {
    start: async () => [{ type: 'listen' }],
    turn: async () => {
      await sleep(150);
      return [{ type: 'neutral', text: 'done thinking' }, { type: 'listen' }];
    },
  });
  const { sessionId } = await orch.startSession({ flow: 'slow', turnBudgetMs: 50 });
  const first = await orch.handleTurn({ sessionId, transcript: 'did I take it?' });
  assert.deepEqual(first.actions.map((a) => a.type), ['neutral', 'wait']);
  const second = await orch.handleTurn({ sessionId, isFinal: true }); // still working → hold again
  assert.equal(second.actions[1].type, 'wait');
  await sleep(120);
  const third = await orch.handleTurn({ sessionId, isFinal: true });
  assert.deepEqual(third.actions, [{ type: 'neutral', text: 'done thinking' }, { type: 'listen' }]);
});

test('a flow that crashes or returns bad actions falls back to the keypad', async () => {
  orch.registerFlow('broken', { start: async () => [{ type: 'listen' }], turn: async () => { throw new Error('boom'); } });
  orch.registerFlow('sloppy', { start: async () => [{ type: 'listen' }], turn: async () => [{ type: 'play' }] });
  const a = await orch.startSession({ flow: 'broken' });
  const b = await orch.startSession({ flow: 'sloppy' });
  assert.deepEqual((await orch.handleTurn({ sessionId: a.sessionId, transcript: 'hi' })).actions, [{ type: 'fallback', reason: 'flow_error' }]);
  assert.deepEqual((await orch.handleTurn({ sessionId: b.sessionId, transcript: 'hi' })).actions, [{ type: 'fallback', reason: 'invalid_actions' }]);
});

test('after 8 turns the call is handed over and ended', async () => {
  const { sessionId } = await start();
  for (let i = 0; i < 8; i++) await orch.handleTurn({ sessionId, transcript: `turn ${i}` });
  const ninth = await orch.handleTurn({ sessionId, transcript: 'one more' });
  assert.equal(ninth.actions.at(-1).type, 'hangup');
  await assert.rejects(orch.handleTurn({ sessionId, transcript: 'still there?' }), (e) => e.status === 404);
});

test('init sets up state; onEnd runs once on hang-up, including a call that ends on its first reply', async () => {
  const ended = [];
  orch.registerFlow('short', {
    start: async (s) => (s.state.endAtOnce ? [{ type: 'neutral', text: 'Already done. Bye.' }, { type: 'hangup' }] : [{ type: 'listen' }]),
    turn: async () => [{ type: 'neutral', text: 'Bye.' }, { type: 'hangup' }],
    onEnd: async (s) => ended.push(s.state.tag),
  });
  await orch.startSession({ flow: 'short', init: (s) => { s.state = { tag: 'first-reply', endAtOnce: true }; } });
  const { sessionId } = await orch.startSession({ flow: 'short', init: (s) => { s.state = { tag: 'later' }; } });
  await orch.handleTurn({ sessionId, transcript: 'ok' });
  assert.deepEqual(ended, ['first-reply', 'later']);
  await assert.rejects(orch.handleTurn({ sessionId, transcript: 'again' }), (e) => e.status === 404);
  assert.deepEqual(ended, ['first-reply', 'later']); // not twice
});

test('a fallback also ends the call and runs onEnd', async () => {
  let ends = 0;
  orch.registerFlow('fails', { start: async () => [{ type: 'listen' }], turn: async () => { throw new Error('x'); }, onEnd: async () => { ends++; } });
  const { sessionId } = await orch.startSession({ flow: 'fails' });
  assert.equal((await orch.handleTurn({ sessionId, transcript: 'hi' })).actions[0].type, 'fallback');
  assert.equal(ends, 1);
  await assert.rejects(orch.handleTurn({ sessionId, transcript: 'hi' }), (e) => e.status === 404);
});

test('unknown session and wrong flow are rejected', async () => {
  await assert.rejects(orch.handleTurn({ sessionId: 'nope', transcript: 'hi' }), (e) => e.status === 404);
  const { sessionId } = await start();
  await assert.rejects(orch.handleTurn({ sessionId, flow: 'dose', transcript: 'hi' }), (e) => e.status === 400);
});

test('a broken safety screen never blocks the call, and the keyword list still catches red flags', async () => {
  setSafetyScreen(async () => { throw new Error('screen down'); });
  try {
    const { sessionId } = await start();
    const r = await orch.handleTurn({ sessionId, transcript: 'hello' });
    assert.equal(r.actions[0].text, 'heard: hello');
    assert.equal((await orch.handleTurn({ sessionId, transcript: 'I fell down' })).emergency, 'fall');
    assert.equal((await orch.handleTurn({ sessionId, dtmf: '9' })).emergency, 'help_key');
  } finally {
    setSafetyScreen(realScreen);
  }
});

test('POST /agent/turn checks input and returns the actions', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/agent', require('../routes/agentRoutes'));
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/v1/agent/turn`;
  const post = async (body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    const { sessionId } = await start();
    const ok = await post({ sessionId, flow: 'echo', transcript: 'hello', isFinal: true, asrConfidence: 0.9 });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.actions[0].text, 'heard: hello');
    assert.equal((await post({ transcript: 'hi' })).status, 400);
    assert.equal((await post({ sessionId, isFinal: 'yes' })).status, 400);
    assert.equal((await post({ sessionId, dtmf: '99' })).status, 400);
    assert.equal((await post({ sessionId: 'unknown', transcript: 'hi' })).status, 404);
  } finally {
    server.close();
  }
});
