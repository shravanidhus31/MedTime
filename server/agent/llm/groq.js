// Groq back end, through Groq's OpenAI-compatible API (the `openai` npm package).
// Facts from Groq's docs (checked when this was written):
// - structured outputs (response_format json_schema) can't be combined with tools in one request
// - strict json_schema works on gpt-oss-20b/120b, not on gpt-oss-safeguard-20b (best effort only)
// - reasoning_effort (low|medium|high) only on gpt-oss-20b/120b; reasoning_format isn't supported on gpt-oss
// - no parallel tool calls on the gpt-oss models
// - a 429 carries `retry-after` in seconds

const {
  OpenAI,
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  RateLimitError,
} = require('openai');
const { LlmError } = require('./errors');
const { validateAgainst, parseJson } = require('./validate');

const BASE_URL = 'https://api.groq.com/openai/v1';

let client;
function getClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new LlmError('config', 'GROQ_API_KEY is not set. Add it to server/.env (see .env.example).');
  }
  if (!client) client = new OpenAI({ apiKey: apiKey.trim(), baseURL: BASE_URL, maxRetries: 0 });
  return client;
}

const supportsEffort = (model) => /gpt-oss-(20b|120b)$/.test(model);
const supportsStrictJson = (model) => !/safeguard/.test(model);

// ── Requests ────────────────────────────────────────────────────────────────

function toGroqMessages(system, messages) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        name: m.name,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    } else if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        })),
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

function toGroqTools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

function buildRequest({ model, system, messages, tools, jsonSchema, maxTokens, effort }) {
  const body = {
    model,
    messages: toGroqMessages(system, messages),
    max_completion_tokens: maxTokens,
  };
  if (effort && supportsEffort(model)) body.reasoning_effort = effort;
  if (tools && tools.length) {
    body.tools = toGroqTools(tools);
    body.tool_choice = 'auto';
  }
  if (jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: jsonSchema.name || 'reply',
        strict: supportsStrictJson(model),
        schema: jsonSchema.schema,
      },
    };
  }
  return body;
}

// ── Responses ───────────────────────────────────────────────────────────────

const STOP_REASONS = {
  stop: 'end',
  tool_calls: 'tool_use',
  length: 'max_tokens',
  content_filter: 'refusal',
};

// Each tool call is parsed and checked against its tool's schema. A bad call is kept,
// with `error` set, so the loop can log it and decide what to do.
function readToolCall(tc, tools) {
  const name = tc.function && tc.function.name;
  const call = { id: tc.id, name, input: null };
  const tool = (tools || []).find((t) => t.name === name);
  if (!tool) {
    call.error = `unknown tool "${name}"`;
    return call;
  }
  const parsed = parseJson(tc.function.arguments || '{}');
  if (!parsed.ok) {
    call.error = `arguments are ${parsed.error}`;
    return call;
  }
  call.input = parsed.value;
  if (tool.inputSchema) {
    const valid = validateAgainst(tool.inputSchema, parsed.value);
    if (!valid.ok) call.error = `arguments don't match the schema: ${valid.error}`;
  }
  return call;
}

function fromGroqResponse(res, tools) {
  const choice = (res.choices && res.choices[0]) || {};
  const message = choice.message || {};
  const usage = res.usage || {};
  return {
    text: message.content || '',
    toolCalls: (message.tool_calls || []).map((tc) => readToolCall(tc, tools)),
    stopReason: STOP_REASONS[choice.finish_reason] || choice.finish_reason || 'unknown',
    usage: {
      inputTokens: usage.prompt_tokens || 0,
      outputTokens: usage.completion_tokens || 0,
      reasoningTokens: (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) || 0,
    },
  };
}

// ── Errors (most specific first: rate limit → timeout → connection → API status) ──

function headerValue(headers, key) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(key) ?? undefined;
  return headers[key];
}

function mapError(err) {
  if (err instanceof LlmError) return err;

  if (err instanceof RateLimitError) {
    const seconds = Number(headerValue(err.headers, 'retry-after'));
    return new LlmError('rate_limit', 'Groq rate limit reached', {
      status: 429,
      retryAfterMs: Number.isFinite(seconds) ? seconds * 1000 : undefined,
      cause: err,
    });
  }
  if (err instanceof APIConnectionTimeoutError) {
    return new LlmError('timeout', 'Groq request timed out', { cause: err });
  }
  if (err instanceof APIConnectionError) {
    return new LlmError('connection', `Could not reach Groq: ${err.message}`, { cause: err });
  }
  if (err instanceof APIError) {
    const status = err.status;
    const body = err.error || {};
    const code = body.code || (body.error && body.error.code);
    // Groq's own codes for a tool call or JSON reply the model got wrong: worth one retry.
    if (code === 'tool_use_failed' || code === 'json_validate_failed') {
      return new LlmError('invalid_output', `Model produced invalid output (${code})`, { status, code, cause: err });
    }
    if (status === 401 || status === 403) {
      return new LlmError('auth', 'Groq rejected the API key', { status, code, cause: err });
    }
    if (status === 498 || (status >= 500 && status < 600)) {
      return new LlmError('server', `Groq server error ${status}`, { status, code, cause: err });
    }
    return new LlmError('bad_request', `Groq rejected the request (${status}): ${err.message}`, { status, code, cause: err });
  }
  if (err && err.name === 'AbortError') {
    return new LlmError('timeout', 'Groq request aborted', { cause: err });
  }
  return new LlmError('connection', `Unexpected Groq failure: ${err && err.message}`, { cause: err });
}

// ── Call ────────────────────────────────────────────────────────────────────

async function complete(req, { timeoutMs }) {
  const body = buildRequest(req);
  try {
    const res = await getClient().chat.completions.create(body, { timeout: timeoutMs, maxRetries: 0 });
    return fromGroqResponse(res, req.tools);
  } catch (err) {
    throw mapError(err);
  }
}

module.exports = {
  name: 'groq',
  complete,
  // exported for tests
  buildRequest,
  fromGroqResponse,
  mapError,
};
