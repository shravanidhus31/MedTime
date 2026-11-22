// One error type for every LLM failure, whatever the provider.
// Callers look at `kind` (and `retryable`) and fall back to the keypad flow during a call.

const RETRYABLE_KINDS = new Set(['rate_limit', 'timeout', 'connection', 'server', 'invalid_output']);

class LlmError extends Error {
  /**
   * @param {'config'|'rate_limit'|'timeout'|'connection'|'server'|'bad_request'|'auth'|'invalid_output'} kind
   * @param {string} message
   * @param {{ status?: number, code?: string, retryAfterMs?: number, cause?: unknown }} [extra]
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = extra.status;
    this.code = extra.code;
    this.retryAfterMs = extra.retryAfterMs;
    if (extra.cause) this.cause = extra.cause;
  }

  get retryable() {
    return RETRYABLE_KINDS.has(this.kind);
  }
}

module.exports = { LlmError };
