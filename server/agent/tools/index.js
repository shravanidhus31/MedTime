// Tool registry (A2.2, contract C1).
//
// A tool is:
//   {
//     name: 'mark_dose',                 // lower_snake_case, unique
//     description: 'Record a dose ...',   // what the model reads
//     inputSchema: { type: 'object', ... },// JSON Schema for the input; checked before run()
//     approvalLevel: 0 | 1 | 2,           // 0 agent alone, 1 caregiver approves, 2 doctor approves
//     run: async (input, ctx) => ({ ok: true, data }) | ({ ok: false, error: '...' }),
//   }
// ctx = { patientId, runId, flow, now }
//
// Each owner registers their tools from their own file, e.g. agent/tools/core.js.

const tools = new Map();
const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function registerTool(tool) {
  if (!tool || typeof tool !== 'object') throw new TypeError('registerTool needs a tool object');
  const { name, description, inputSchema, run } = tool;
  const approvalLevel = tool.approvalLevel ?? 0;

  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    throw new TypeError(`Tool name "${name}" must be lower_snake_case`);
  }
  if (tools.has(name)) throw new Error(`Tool "${name}" is already registered`);
  if (typeof description !== 'string' || !description.trim()) {
    throw new TypeError(`Tool "${name}" needs a description`);
  }
  if (!inputSchema || inputSchema.type !== 'object') {
    throw new TypeError(`Tool "${name}" needs an inputSchema of type "object"`);
  }
  if (![0, 1, 2].includes(approvalLevel)) {
    throw new TypeError(`Tool "${name}" approvalLevel must be 0, 1 or 2`);
  }
  if (typeof run !== 'function') throw new TypeError(`Tool "${name}" needs a run(input, ctx) function`);

  const registered = Object.freeze({ name, description, inputSchema, approvalLevel, run });
  tools.set(name, registered);
  return registered;
}

function getTool(name) {
  return tools.get(name);
}

// listTools() → every tool; listTools(['a', 'b']) → just those, and throws on an unknown name,
// so a flow that asks for a tool nobody registered fails at once rather than mid-call.
function listTools(names) {
  if (!names) return [...tools.values()];
  return names.map((name) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`No tool registered with the name "${name}"`);
    return tool;
  });
}

// For tests only.
function _resetTools() {
  tools.clear();
}

module.exports = { registerTool, getTool, listTools, _resetTools };
