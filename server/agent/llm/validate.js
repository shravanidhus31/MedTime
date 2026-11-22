// Our own schema check. JSON mode alone doesn't guarantee the schema (A2.1),
// so tool arguments and structured replies are always validated here.

const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = new WeakMap();

function validateAgainst(schema, value) {
  let check = compiled.get(schema);
  if (!check) {
    check = ajv.compile(schema);
    compiled.set(schema, check);
  }
  if (check(value)) return { ok: true };
  return { ok: false, error: ajv.errorsText(check.errors, { dataVar: 'value' }) };
}

// Parses model output as JSON. Tolerates a ```json fence, which best-effort mode sometimes adds.
function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty output' };
  let body = text.trim();
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) body = fence[1];
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (err) {
    return { ok: false, error: `not valid JSON: ${err.message}` };
  }
}

module.exports = { validateAgainst, parseJson };
