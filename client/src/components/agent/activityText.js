// Plain-language text for the Agent activity timeline (UI pass, 22 Nov): what the agent checked,
// decided or did, instead of tool names and JSON. The raw step stays available under "Details".

const CATEGORY = { fall: 'a fall', chest_pain: 'chest pain', breathing: 'trouble breathing', breathlessness: 'trouble breathing', extra_pills: 'extra tablets', financial_scam: 'a possible scam', scam: 'a possible scam', self_harm: 'words about self-harm', sudden_confusion: 'sudden confusion', help_key: 'the help key (9)' };

export function runTitle(run) {
  const t = run.trigger;
  if (t === 'dose_due') return 'Dose due: should MedTime call?';
  if (t === 'phone_call') return 'Dose call (phone)';
  if (t === 'simulate') return run.flow === 'chat' ? 'Weekly chat (browser)' : 'Dose call (browser or simulated)';
  if (t === 'callin') return 'She called MedTime';
  if (t === 'weekly_chat') return 'Weekly chat call';
  if (t === 'weekly_review') return 'Weekly review';
  if (t === 'copilot') return 'Copilot question';
  if (t === 'journal') return 'Evening journal';
  if (t === 'prescription_upload' || t === 'prescription') return 'Prescription read';
  if (t === 'dose') return 'Dose call';
  return 'Agent run';
}

export function stepText(step) {
  if (step.summaryText) return step.summaryText;
  const out = step.output || {};
  const data = out.data || {};
  const failed = out.ok === false;
  switch (step.tool) {
    case 'get_patient_context': return 'Read her profile, medicines and family contacts.';
    case 'check_double_dose': return failed ? 'Could not check the dose log.' : data.alreadyTaken ? 'Checked the dose log: already taken. No reminder needed.' : 'Checked the dose log: not taken yet.';
    case 'place_call': return failed ? `Tried to call her, but the call could not be placed${out.error ? ` (${out.error})` : ''}.` : `Called her${data.channel === 'phone_agent' ? ' (talking assistant)' : data.channel === 'keypad' ? ' (keypad menu)' : ''}${data.attempt === 'retry' ? ', again' : ''}.`;
    case 'mark_dose': return failed ? 'Could not record the dose.' : `Recorded the dose as ${(step.input && step.input.status) || 'taken'}.`;
    case 'notify_caregiver': return failed ? `Tried to phone the family, but could not${out.error ? ` (${out.error})` : ''}.` : 'Phoned the family.';
    case 'ask_caregiver': return `Asked the family on the dashboard: "${(step.input && step.input.question) || ''}"`;
    case 'safety_screen': return out.verdict === 'redflag' ? `Red flag: ${CATEGORY[out.category] || out.category}. Switched to emergency mode and phoned the family.` : 'Safety check: nothing urgent.';
    case 'get_dose_history': return 'Looked up her recent doses.';
    case 'get_care_notes': return 'Read her journal, follow-ups and weekly review.';
    case 'lookup_life_notes': return 'Searched the family\'s notes about her life.';
    case 'search_guidance': return `Searched the care-guidance library${step.input && step.input.query ? ` for "${step.input.query}"` : ''}.`;
    case 'callin_answer': return `Answered her question from ${out.source === 'life_notes' ? 'the family\'s notes' : 'the dose log'}.`;
    case 'claim_check': return 'Checked its own reply before sending it.';
    default: return String(step.tool || 'step').replace(/_/g, ' ');
  }
}

// Short label for the badge: who or what this step is about.
export function stepKind(step) {
  if (step.label) return step.label;
  if (['patient_said'].includes(step.tool)) return 'patient_said';
  if (['mark_dose', 'notify_caregiver', 'ask_caregiver', 'place_call', 'agent_said', 'propose_change'].includes(step.tool)) return 'action_taken';
  return 'agent_noticed';
}
