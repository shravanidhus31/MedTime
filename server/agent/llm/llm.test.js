// Offline tests for the LLM adapter: request building, response reading, error mapping
// and input checks. No network. The live check is `npm run llm:check`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { APIError, APIConnectionError, APIConnectionTimeoutError } = require('openai');

const groq = require('./groq');
const { chat, LlmError } = require('./index');
const { modelFor } = require('./config');
const { parseJson, validateAgainst } = require('./validate');

const markDoseTool = {
  name: 'mark_dose',
  description: 'Record a dose',
  inputSchema: {
    type: 'object',
    properties: {
      reminderId: { type: 'string' },
      status: { type: 'string', enum: ['taken', 'skipped'] },
    },
    required: ['reminderId', 'status'],
    additionalProperties: false,
  },
};

// ── config ──────────────────────────────────────────────────────────────────

test('tiers map to the Groq defaults, and env overrides win', () => {
  const saved = process.env.LLM_MODEL_FAST;
  delete process.env.LLM_MODEL_FAST;
  assert.equal(modelFor('fast', 'groq'), 'openai/gpt-oss-20b');
  assert.equal(modelFor('smart', 'groq'), 'openai/gpt-oss-120b');
  assert.equal(modelFor('safety', 'groq'), 'openai/gpt-oss-safeguard-20b');
  process.env.LLM_MODEL_FAST = 'some/other-model';
  assert.equal(modelFor('fast', 'groq'), 'some/other-model');
  if (saved === undefined) delete process.env.LLM_MODEL_FAST;
  else process.env.LLM_MODEL_FAST = saved;
});

// ── request building ────────────────────────────────────────────────────────

test('buildRequest maps messages, tool results and tools', () => {
  const body = groq.buildRequest({
    model: 'openai/gpt-oss-20b',
    system: 'You are MedTime.',
    messages: [
      { role: 'user', content: 'I took it' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'mark_dose', input: { reminderId: 'r1', status: 'taken' } }] },
      { role: 'tool', toolCallId: 'c1', name: 'mark_dose', content: { ok: true } },
    ],
    tools: [markDoseTool],
    maxTokens: 512,
    effort: 'low',
  });

  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[2].tool_calls[0].function.arguments, '{"reminderId":"r1","status":"taken"}');
  assert.deepEqual(body.messages[3], { role: 'tool', tool_call_id: 'c1', name: 'mark_dose', content: '{"ok":true}' });
  assert.equal(body.tools[0].function.name, 'mark_dose');
  assert.equal(body.tool_choice, 'auto');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.max_completion_tokens, 512);
});

test('reasoning_effort only goes to gpt-oss 20b/120b; strict JSON is off for safeguard', () => {
  const schema = { name: 'label', schema: { type: 'object', properties: {}, additionalProperties: false } };
  const safety = groq.buildRequest({ model: 'openai/gpt-oss-safeguard-20b', messages: [{ role: 'user', content: 'x' }], jsonSchema: schema, effort: 'low' });
  assert.equal(safety.reasoning_effort, undefined);
  assert.equal(safety.response_format.json_schema.strict, false);

  const fast = groq.buildRequest({ model: 'openai/gpt-oss-20b', messages: [{ role: 'user', content: 'x' }], jsonSchema: schema, effort: 'low' });
  assert.equal(fast.reasoning_effort, 'low');
  assert.equal(fast.response_format.json_schema.strict, true);
});

// ── response reading ────────────────────────────────────────────────────────

const response = (toolCalls, finish = 'tool_calls') => ({
  choices: [{ finish_reason: finish, message: { content: null, tool_calls: toolCalls } }],
  usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 3 } },
});

test('a valid tool call is parsed and passes the schema check', () => {
  const out = groq.fromGroqResponse(
    response([{ id: 'c1', function: { name: 'mark_dose', arguments: '{"reminderId":"r1","status":"taken"}' } }]),
    [markDoseTool],
  );
  assert.equal(out.stopReason, 'tool_use');
  assert.deepEqual(out.toolCalls[0], { id: 'c1', name: 'mark_dose', input: { reminderId: 'r1', status: 'taken' } });
  assert.deepEqual(out.usage, { inputTokens: 10, outputTokens: 5, reasoningTokens: 3 });
});

test('bad tool calls are kept with an error: wrong schema, bad JSON, unknown tool', () => {
  const out = groq.fromGroqResponse(
    response([
      { id: 'a', function: { name: 'mark_dose', arguments: '{"reminderId":"r1","status":"double"}' } },
      { id: 'b', function: { name: 'mark_dose', arguments: '{not json' } },
      { id: 'c', function: { name: 'delete_patient', arguments: '{}' } },
    ]),
    [markDoseTool],
  );
  assert.match(out.toolCalls[0].error, /schema/);
  assert.match(out.toolCalls[1].error, /not valid JSON/);
  assert.match(out.toolCalls[2].error, /unknown tool/);
});

test('finish reasons map to neutral stop reasons', () => {
  assert.equal(groq.fromGroqResponse(response(undefined, 'stop')).stopReason, 'end');
  assert.equal(groq.fromGroqResponse(response(undefined, 'length')).stopReason, 'max_tokens');
  assert.equal(groq.fromGroqResponse(response(undefined, 'content_filter')).stopReason, 'refusal');
});

// ── error mapping ───────────────────────────────────────────────────────────

test('errors map most-specific-first', () => {
  const rate = groq.mapError(APIError.generate(429, { error: { message: 'slow down' } }, 'slow down', new Headers({ 'retry-after': '2' })));
  assert.equal(rate.kind, 'rate_limit');
  assert.equal(rate.retryAfterMs, 2000);
  assert.equal(rate.retryable, true);

  assert.equal(groq.mapError(new APIConnectionTimeoutError()).kind, 'timeout');
  assert.equal(groq.mapError(new APIConnectionError({ message: 'down' })).kind, 'connection');
  assert.equal(groq.mapError(APIError.generate(503, {}, 'busy', new Headers())).kind, 'server');

  const auth = groq.mapError(APIError.generate(401, {}, 'bad key', new Headers()));
  assert.equal(auth.kind, 'auth');
  assert.equal(auth.retryable, false);

  const badTool = groq.mapError(APIError.generate(400, { error: { code: 'tool_use_failed' } }, 'failed', new Headers()));
  assert.equal(badTool.kind, 'invalid_output');
  assert.equal(badTool.retryable, true);

  assert.equal(groq.mapError(APIError.generate(400, {}, 'bad', new Headers())).kind, 'bad_request');
});

// ── chat() input checks (fail before any network call) ──────────────────────

test('chat() rejects an unknown tier, no messages, and tools + JSON schema together', async () => {
  const msgs = [{ role: 'user', content: 'hi' }];
  await assert.rejects(chat({ tier: 'huge', messages: msgs }), (e) => e instanceof LlmError && e.kind === 'config');
  await assert.rejects(chat({ tier: 'fast', messages: [] }), (e) => e.kind === 'config');
  await assert.rejects(
    chat({ tier: 'fast', messages: msgs, tools: [markDoseTool], jsonSchema: { name: 'x', schema: {} } }),
    (e) => e.kind === 'config',
  );
});

test('chat() without a Groq key fails with a config error, not a crash', async () => {
  const saved = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = '';
  await assert.rejects(chat({ tier: 'fast', messages: [{ role: 'user', content: 'hi' }] }), (e) => e.kind === 'config' && /GROQ_API_KEY/.test(e.message));
  if (saved === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = saved;
});

// ── validation helpers ──────────────────────────────────────────────────────

test('parseJson accepts fenced JSON; validateAgainst reports schema errors', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```').value, { a: 1 });
  assert.equal(parseJson('').ok, false);
  assert.equal(validateAgainst(markDoseTool.inputSchema, { reminderId: 'r1' }).ok, false);
});
