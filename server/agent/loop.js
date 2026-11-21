// Agent loop (A2.2). Asks the model, runs the tool it picks, feeds the result back, and repeats
// until the model answers without a tool call.
//
//   const result = await runLoop({
//     tier: 'fast',
//     system: loadPrompt('base').text,
//     promptVersion: 'base@1',
//     messages: [{ role: 'user', content: 'Patient said: "I already took it"' }],
//     tools: ['get_dose_history', 'check_double_dose', 'mark_dose'],
//     ctx: { patientId, runId, flow: 'dose' },
//     onStep: (step) => agentRun.addStep(step),   // A2.3 logs each step
//   });
//
// Guardrails:
// - at most `maxToolCalls` tool calls per run (8)
// - `timeoutMs` for the whole run (30 s by default; a phone turn passes its 4 s budget)
// - a tool with approvalLevel > 0 is never run: it is sent to proposeChange() and the
//   run's outcome becomes 'queued_for_approval'
// - on overrun, LLM error or refusal the loop stops with outcome 'fallback' and a reason.
//   The caller then uses the rule-based flow (the keypad menu during a call).
//
// Returns { outcome: 'done' | 'queued_for_approval' | 'fallback', text, fallbackReason?, error?,
//           steps[], messages[], toolCalls, llmCalls, usage, promptVersion, model, ms }.
// steps[i] = { tool, input, output, ms, at, approvalLevel, proposalId? }

const { chat } = require('./llm');
const { listTools } = require('./tools');
const { proposeChange } = require('./proposals');

const DEFAULT_MAX_TOOL_CALLS = 8;
const DEFAULT_TIMEOUT_MS = 30000;
const MIN_LLM_CALL_MS = 300;

async function runLoop({
  tier = 'fast',
  system,
  promptVersion,
  messages,
  tools: toolNames = [],
  ctx = {},
  maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onStep,
  chatFn = chat, // swapped out in tests
} = {}) {
  if (!Array.isArray(messages) || messages.length === 0) throw new Error('runLoop needs at least one message');

  const started = Date.now();
  const deadline = started + timeoutMs;
  const tools = listTools(toolNames);
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const convo = [...messages];
  const steps = [];
  const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  let toolCalls = 0;
  let llmCalls = 0;
  let queued = false;
  let model;

  const finish = (outcome, extra = {}) => ({
    outcome: outcome === 'done' && queued ? 'queued_for_approval' : outcome,
    text: '',
    ...extra,
    steps,
    messages: convo,
    toolCalls,
    llmCalls,
    usage,
    promptVersion,
    model,
    ms: Date.now() - started,
  });
  const fallback = (reason, error) =>
    finish('fallback', { fallbackReason: reason, error: error ? { kind: error.kind, message: error.message } : undefined });

  const toolCtx = { ...ctx, now: ctx.now || new Date() };

  async function record(step) {
    steps.push(step);
    if (onStep) {
      try {
        await onStep(step);
      } catch (err) {
        console.error('[agent:loop] onStep failed:', err.message); // logging must never break a call
      }
    }
  }

  async function handleCall(call) {
    const at = new Date();
    const t0 = Date.now();
    const tool = toolsByName.get(call.name);
    const step = { tool: call.name, input: call.input, at, approvalLevel: tool ? tool.approvalLevel : undefined };
    let output;

    if (!tool) {
      output = { ok: false, error: `Tool "${call.name}" is not available in this run` };
    } else if (call.error) {
      output = { ok: false, error: `Invalid tool call: ${call.error}` };
    } else if (tool.approvalLevel > 0) {
      const proposal = await proposeChange({ tool: tool.name, input: call.input, level: tool.approvalLevel, ctx: toolCtx });
      queued = true;
      step.proposalId = proposal.proposalId;
      output = {
        ok: true,
        data: {
          queuedForApproval: true,
          proposalId: proposal.proposalId,
          approver: tool.approvalLevel === 2 ? 'doctor' : 'caregiver',
          note: 'Not done yet. It happens only if it is approved.',
        },
      };
    } else {
      output = await runTool(tool, call.input, toolCtx, deadline - Date.now());
    }

    step.output = output;
    step.ms = Date.now() - t0;
    await record(step);
    return output;
  }

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_LLM_CALL_MS) return fallback('timeout');

    let reply;
    try {
      reply = await chatFn({ tier, system, messages: convo, tools, timeoutMs: remaining });
    } catch (err) {
      return fallback(err && err.kind ? `llm_${err.kind}` : 'llm_error', err);
    }
    llmCalls++;
    model = reply.model || model;
    if (reply.usage) {
      usage.inputTokens += reply.usage.inputTokens || 0;
      usage.outputTokens += reply.usage.outputTokens || 0;
      usage.reasoningTokens += reply.usage.reasoningTokens || 0;
    }

    if (reply.stopReason === 'refusal') return fallback('refusal');
    if (!reply.toolCalls || reply.toolCalls.length === 0) {
      if (reply.stopReason === 'max_tokens') return fallback('max_tokens');
      return finish('done', { text: reply.text || '' });
    }

    convo.push({
      role: 'assistant',
      content: reply.text || '',
      toolCalls: reply.toolCalls.map(({ id, name, input }) => ({ id, name, input })),
    });

    // gpt-oss on Groq doesn't make parallel calls; if a model sends several, they run in order.
    for (const call of reply.toolCalls) {
      if (toolCalls >= maxToolCalls) return fallback('too_many_tool_calls');
      toolCalls++;
      const output = await handleCall(call);
      convo.push({ role: 'tool', toolCallId: call.id, name: call.name, content: output });
    }
  }
}

// Runs one tool. A tool that throws, hangs past the deadline or returns a bad shape
// becomes { ok: false, error }, which the model sees and can work around.
async function runTool(tool, input, ctx, remainingMs) {
  if (remainingMs <= 0) return { ok: false, error: 'No time left to run the tool' };
  let timer;
  try {
    const out = await Promise.race([
      Promise.resolve().then(() => tool.run(input, ctx)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Tool "${tool.name}" timed out`)), remainingMs);
      }),
    ]);
    if (!out || typeof out.ok !== 'boolean') {
      return { ok: false, error: `Tool "${tool.name}" returned an invalid result` };
    }
    return out;
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { runLoop, DEFAULT_MAX_TOOL_CALLS, DEFAULT_TIMEOUT_MS };
