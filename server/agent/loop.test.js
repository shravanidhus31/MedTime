// Offline tests for the tool registry, the loop and versioned prompts.
// The model is replaced by a scripted chatFn so limits and failures can be tested exactly.
// The live check against Groq is `npm run loop:check`.

const test = require('node:test');
const assert = require('node:assert/strict');

const { registerTool, listTools, _resetTools } = require('./tools');
const { runLoop } = require('./loop');
const { setProposalHandler } = require('./proposals');
const { loadPrompt } = require('./prompts');
const { LlmError } = require('./llm/errors');

const objectSchema = { type: 'object', properties: {}, additionalProperties: true };

// A scripted model: each call returns the next reply in the list.
function scripted(...replies) {
  const calls = [];
  const fn = async (req) => {
    calls.push(req);
    const next = replies.shift();
    if (!next) throw new Error('scripted chat ran out of replies');
    if (next instanceof Error) throw next;
    return { stopReason: next.toolCalls ? 'tool_use' : 'end', text: '', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, model: 'test', ...next };
  };
  fn.calls = calls;
  return fn;
}
const callTool = (name, input = {}, id = `c-${Math.random()}`) => ({ toolCalls: [{ id, name, input }] });
const say = (text) => ({ text });

test.beforeEach(() => {
  _resetTools();
  setProposalHandler(async () => ({ proposalId: 'p-1', status: 'pending' }));
});

// ── registry ────────────────────────────────────────────────────────────────

test('registerTool checks the C1 shape and rejects duplicates', () => {
  const good = { name: 'get_time', description: 'Time now', inputSchema: objectSchema, run: async () => ({ ok: true }) };
  assert.equal(registerTool(good).approvalLevel, 0);
  assert.throws(() => registerTool(good), /already registered/);
  assert.throws(() => registerTool({ ...good, name: 'BadName' }), /lower_snake_case/);
  assert.throws(() => registerTool({ ...good, name: 'no_schema', inputSchema: undefined }), /inputSchema/);
  assert.throws(() => registerTool({ ...good, name: 'bad_level', approvalLevel: 3 }), /approvalLevel/);
  assert.throws(() => registerTool({ ...good, name: 'no_run', run: 'x' }), /run/);
  assert.throws(() => listTools(['missing_tool']), /No tool registered/);
});

// ── loop ────────────────────────────────────────────────────────────────────

test('no tool call: the run is done with the model text', async () => {
  const result = await runLoop({ messages: [{ role: 'user', content: 'hi' }], chatFn: scripted(say('Hello')) });
  assert.equal(result.outcome, 'done');
  assert.equal(result.text, 'Hello');
  assert.equal(result.steps.length, 0);
});

test('a tool call runs, gets ctx, is logged, and its result goes back to the model', async () => {
  let seenCtx;
  registerTool({
    name: 'check_double_dose',
    description: 'x',
    inputSchema: objectSchema,
    run: async (input, ctx) => {
      seenCtx = ctx;
      return { ok: true, data: { alreadyTaken: false } };
    },
  });
  const logged = [];
  const chatFn = scripted(callTool('check_double_dose', { reminderId: 'r1' }, 'c1'), say('Not taken yet'));
  const result = await runLoop({
    messages: [{ role: 'user', content: 'go' }],
    tools: ['check_double_dose'],
    ctx: { patientId: 'p1', runId: 'run1', flow: 'dose' },
    onStep: (s) => logged.push(s),
    promptVersion: 'base@1',
    chatFn,
  });

  assert.equal(result.outcome, 'done');
  assert.equal(result.text, 'Not taken yet');
  assert.equal(seenCtx.patientId, 'p1');
  assert.ok(seenCtx.now instanceof Date);
  assert.equal(logged.length, 1);
  assert.deepEqual(logged[0].output, { ok: true, data: { alreadyTaken: false } });
  assert.equal(typeof logged[0].ms, 'number');
  assert.equal(result.promptVersion, 'base@1');
  // second model call saw the tool result
  const toolMsg = chatFn.calls[1].messages.find((m) => m.role === 'tool');
  assert.equal(toolMsg.toolCallId, 'c1');
});

test('the run stops at 8 tool calls with a fallback', async () => {
  let runs = 0;
  registerTool({ name: 'ping', description: 'x', inputSchema: objectSchema, run: async () => ({ ok: true, data: ++runs }) });
  const replies = Array.from({ length: 12 }, () => callTool('ping'));
  const result = await runLoop({ messages: [{ role: 'user', content: 'go' }], tools: ['ping'], chatFn: scripted(...replies) });
  assert.equal(result.outcome, 'fallback');
  assert.equal(result.fallbackReason, 'too_many_tool_calls');
  assert.equal(runs, 8);
  assert.equal(result.steps.length, 8);
});

test('a tool needing approval is not run: it is proposed and the run is queued', async () => {
  let ran = false;
  let proposed;
  setProposalHandler(async (args) => {
    proposed = args;
    return { proposalId: 'p-42', status: 'pending' };
  });
  registerTool({ name: 'move_dose_time', description: 'x', inputSchema: objectSchema, approvalLevel: 2, run: async () => { ran = true; return { ok: true }; } });
  const result = await runLoop({
    messages: [{ role: 'user', content: 'go' }],
    tools: ['move_dose_time'],
    ctx: { runId: 'run9' },
    chatFn: scripted(callTool('move_dose_time', { to: '07:00' }), say('Asked the doctor')),
  });
  assert.equal(ran, false);
  assert.equal(proposed.level, 2);
  assert.deepEqual(proposed.input, { to: '07:00' });
  assert.equal(result.outcome, 'queued_for_approval');
  assert.equal(result.steps[0].proposalId, 'p-42');
  assert.equal(result.steps[0].output.data.approver, 'doctor');
});

test('a call that failed the schema check is not run; the error goes back to the model', async () => {
  let ran = false;
  registerTool({ name: 'mark_dose', description: 'x', inputSchema: objectSchema, run: async () => { ran = true; return { ok: true }; } });
  const bad = { toolCalls: [{ id: 'c1', name: 'mark_dose', input: { status: 'double' }, error: "arguments don't match the schema" }] };
  const result = await runLoop({ messages: [{ role: 'user', content: 'go' }], tools: ['mark_dose'], chatFn: scripted(bad, say('ok')) });
  assert.equal(ran, false);
  assert.equal(result.steps[0].output.ok, false);
  assert.match(result.steps[0].output.error, /Invalid tool call/);
  assert.equal(result.outcome, 'done');
});

test('a tool that throws or returns a bad shape becomes { ok: false }', async () => {
  registerTool({ name: 'boom', description: 'x', inputSchema: objectSchema, run: async () => { throw new Error('db down'); } });
  registerTool({ name: 'shapeless', description: 'x', inputSchema: objectSchema, run: async () => 'hello' });
  const result = await runLoop({
    messages: [{ role: 'user', content: 'go' }],
    tools: ['boom', 'shapeless'],
    chatFn: scripted(callTool('boom'), callTool('shapeless'), say('done')),
  });
  assert.deepEqual(result.steps[0].output, { ok: false, error: 'db down' });
  assert.match(result.steps[1].output.error, /invalid result/);
});

test('an LLM error, a refusal and a timeout all end in a fallback with the reason', async () => {
  const msgs = [{ role: 'user', content: 'go' }];

  const rate = await runLoop({ messages: msgs, chatFn: scripted(new LlmError('rate_limit', 'slow down')) });
  assert.equal(rate.outcome, 'fallback');
  assert.equal(rate.fallbackReason, 'llm_rate_limit');

  const refused = await runLoop({ messages: msgs, chatFn: scripted({ stopReason: 'refusal', text: '' }) });
  assert.equal(refused.fallbackReason, 'refusal');

  registerTool({ name: 'slow', description: 'x', inputSchema: objectSchema, run: () => new Promise((r) => setTimeout(() => r({ ok: true }), 2000)) });
  const slow = await runLoop({ messages: msgs, tools: ['slow'], timeoutMs: 400, chatFn: scripted(callTool('slow'), say('late')) });
  assert.equal(slow.outcome, 'fallback');
  assert.equal(slow.fallbackReason, 'timeout');
  assert.match(slow.steps[0].output.error, /timed out/);
});

test('a failing onStep logger never breaks the run', async () => {
  registerTool({ name: 'ping', description: 'x', inputSchema: objectSchema, run: async () => ({ ok: true }) });
  const result = await runLoop({
    messages: [{ role: 'user', content: 'go' }],
    tools: ['ping'],
    onStep: () => { throw new Error('mongo down'); },
    chatFn: scripted(callTool('ping'), say('fine')),
  });
  assert.equal(result.outcome, 'done');
});

// ── claim check ─────────────────────────────────────────────────────────────

test('a reply claiming "I\'ve logged it" with no mark_dose is sent back once, then the tool is called', async () => {
  let marked = 0;
  registerTool({ name: 'mark_dose', description: 'x', inputSchema: objectSchema, run: async () => { marked++; return { ok: true, data: { changed: true } }; } });
  const chatFn = scripted(say('Got it. I’ve logged that you took your dose.'), callTool('mark_dose', { status: 'taken' }), say("I've recorded it."));
  const result = await runLoop({ messages: [{ role: 'user', content: 'I took it' }], tools: ['mark_dose'], chatFn });
  assert.equal(result.outcome, 'done');
  assert.equal(marked, 1);
  assert.equal(result.steps[0].tool, 'claim_check');
  const note = result.messages.find((m) => m.role === 'user' && /MedTime system check/.test(m.content));
  assert.match(note.content, /no mark_dose call succeeded/);
});

test('a reply that keeps claiming an action it never took ends in a fallback', async () => {
  const result = await runLoop({
    messages: [{ role: 'user', content: 'tell my daughter' }],
    chatFn: scripted(say("I've called Priya."), say('I have informed your family.')),
  });
  assert.equal(result.outcome, 'fallback');
  assert.equal(result.fallbackReason, 'unbacked_claim');
});

test('claims backed by a tool result pass: "already recorded" after check_double_dose, "I\'ve called" after notify', async () => {
  const { unbackedClaims } = require('./guards');
  const checkedTaken = [{ tool: 'check_double_dose', output: { ok: true, data: { alreadyTaken: true } } }];
  assert.equal(unbackedClaims("Yes, I've noted it's already taken.", checkedTaken), null);
  assert.equal(unbackedClaims('It has already been recorded as taken.', checkedTaken), null);
  assert.match(unbackedClaims('Your evening dose is now logged.', []), /mark_dose/); // passive claims count too
  assert.match(unbackedClaims('It has been recorded.', []), /mark_dose/);
  assert.equal(unbackedClaims("I've called Priya.", [{ tool: 'notify_caregiver', output: { ok: true } }]), null);
  assert.match(unbackedClaims("I've called Priya.", [{ tool: 'notify_caregiver', output: { ok: false } }]), /notify_caregiver/);
  assert.equal(unbackedClaims('Please take your white tablet now.', []), null);
});

// ── prompts ─────────────────────────────────────────────────────────────────

test('loadPrompt returns the text and its version', () => {
  const p = loadPrompt('base');
  assert.equal(p.version, '2');
  assert.equal(p.promptVersion, 'base@2');
  assert.match(p.text, /Never tell the patient to take an extra dose/);
  assert.throws(() => loadPrompt('../secrets'), /Bad prompt name/);
});
