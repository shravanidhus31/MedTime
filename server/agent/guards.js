// Claim check (A2.5). A model can say "I've recorded your dose" without calling mark_dose.
// On a call that would tell the patient something untrue, so the loop checks every final reply:
// a first-person claim of an action needs a successful tool call behind it.
//
// unbackedClaims(text, steps) → a short note for the model, or null when every claim is backed.

const CLAIMS = [
  {
    what: 'recorded the dose',
    // "I've logged it", and the passive "it has been recorded" / "your dose is now logged"
    pattern:
      /\bI(?:'ve| have)?\s+(?:just\s+|now\s+)?(?:logged|recorded|marked|noted|saved|updated)\b|\b(?:has|have)\s+(?:now\s+|just\s+|already\s+)?been\s+(?:logged|recorded|marked)\b|\b(?:is|are)\s+(?:now\s+)?(?:logged|recorded|marked)\b/i,
    // backed by a successful mark_dose, or by check_double_dose finding it already taken
    backedBy: (s) =>
      (s.tool === 'mark_dose' && s.output && s.output.ok) ||
      (s.tool === 'check_double_dose' && s.output && s.output.ok && s.output.data && s.output.data.alreadyTaken),
    tool: 'mark_dose',
  },
  {
    what: 'contacted someone',
    pattern: /\bI(?:'ve| have)?\s+(?:just\s+|now\s+)?(?:called|phoned|informed|notified|told|alerted|messaged|let\s+\w+\s+know)\b/i,
    backedBy: (s) => s.tool === 'notify_caregiver' && s.output && s.output.ok,
    tool: 'notify_caregiver',
  },
  {
    what: 'sent a request for approval',
    pattern: /\bI(?:'ve| have)?\s+(?:just\s+|now\s+)?(?:queued|submitted|requested|sent\s+(?:the|a|your)\s+request)\b/i,
    backedBy: (s) => !!s.proposalId,
    tool: 'the tool that makes this change',
  },
];

function unbackedClaims(text, steps = []) {
  const said = String(text || '').replace(/[’‘]/g, "'");
  const missing = CLAIMS.filter((c) => c.pattern.test(said) && !steps.some(c.backedBy));
  if (missing.length === 0) return null;
  const parts = missing.map((c) => `you ${c.what}, but no ${c.tool} call succeeded`);
  return (
    `Check: your reply says ${parts.join('; and ')}. Nothing has been done yet. ` +
    'If it should be done, call the tool now. Otherwise, reply again without saying it was done.'
  );
}

module.exports = { unbackedClaims };
