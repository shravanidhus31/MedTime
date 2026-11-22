// Versioned prompts (A2.2). Each prompt is agent/prompts/<name>.md with a version header:
//
//   ---
//   version: 1
//   ---
//   You are ... {{patientName}} ...
//
// loadPrompt('dose', { patientName: 'Amma' }) → { name, version, promptVersion: 'dose@1', text }
// Each AgentRun stores promptVersion, so a change in behaviour can be traced to a prompt change.
// Bump the version whenever the wording changes.

const fs = require('fs');
const path = require('path');

const cache = new Map();

function readPrompt(name) {
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error(`Bad prompt name "${name}"`);
  if (cache.has(name)) return cache.get(name);

  const file = path.join(__dirname, `${name}.md`);
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const header = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!header) throw new Error(`Prompt "${name}" has no --- version header ---`);
  const version = (header[1].match(/^version:\s*(\S+)\s*$/m) || [])[1];
  if (!version) throw new Error(`Prompt "${name}" has no version in its header`);

  const prompt = { name, version, body: raw.slice(header[0].length).trim() };
  cache.set(name, prompt);
  return prompt;
}

function loadPrompt(name, vars = {}) {
  const { version, body } = readPrompt(name);
  const text = body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Prompt "${name}" needs a value for {{${key}}}`);
    return String(vars[key]);
  });
  return { name, version, promptVersion: `${name}@${version}`, text };
}

module.exports = { loadPrompt };
