// Dose due → agent (A2.6). The scheduler (jobs/missedDoseCron.js) calls this instead of deciding
// itself, for patients with dementiaMode on.
//
//   const r = await handleDoseDue({ medicine, patient, attempt: 'initial' | 'retry', placeCall });
//   // r = { called: boolean, reason, runId }
//
// What happens:
//   1. an AgentRun is started (trigger 'dose_due') for the due Reminder
//   2. check_double_dose runs: already taken (e.g. confirmed in the app) → no call
//   3. otherwise placeCall() runs: the scheduler's own call, which runs the speech agent on the
//      phone (A3.5, routes/voiceAgentRoutes.js); the keypad menu stays as its fallback.
// The decision is a fixed rule, so it runs as code, not through the LLM: the model would add
// nothing yet and would cost a request per dose. The LLM takes over when the conversation starts.
//
// Safety: if anything here fails, the call is placed anyway, so no dose goes unreminded.

const Reminder = require('../models/Reminder');
const { getTool } = require('./tools');
const { startRun, addStep, finishRun } = require('./runs');

// The call the scheduler places for dementia-mode patients: the speech agent (A3.5), unless
// VOICE_AGENT_CALLS=off puts it back on the keypad menu.
const CHANNEL = () => (String(process.env.VOICE_AGENT_CALLS || 'on').toLowerCase() === 'off' ? 'keypad' : 'phone_agent');
const LOOKBACK_MS = 15 * 60 * 1000; // a due reminder scheduled up to 15 min ago
const LOOKAHEAD_MS = 60 * 1000;

// The reminder this tick is about: the latest one for this medicine that isn't taken yet.
// For a first call, it must be due now; for a re-call (after a snooze), any earlier one today.
async function findDueReminder(medicine, attempt, now) {
  const from = attempt === 'retry' ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : new Date(now.getTime() - LOOKBACK_MS);
  return Reminder.findOne({
    medicine: medicine._id,
    scheduledTime: { $gte: from, $lte: new Date(now.getTime() + LOOKAHEAD_MS) },
    status: { $in: ['pending', 'alerted', 'taken'] },
  }).sort({ scheduledTime: -1 });
}

async function timed(fn) {
  const at = new Date();
  const t0 = Date.now();
  const output = await fn();
  return { output, at, ms: Date.now() - t0 };
}

// `reminder` (A1.3): the scheduler now works per dose and passes the due Reminder itself.
// Without it, the latest due one for the medicine is looked up, as before.
async function handleDoseDue({ medicine, patient, reminder: givenReminder, attempt = 'initial', placeCall, now = new Date() }) {
  require('./index').initAgent(); // make sure the core tools are registered (no-op after the first time)
  const started = Date.now();
  let runId = null;
  const steps = [];
  const log = async (step) => {
    steps.push(step);
    if (runId) await addStep(runId, step).catch((err) => console.error('[agent:doseDue] could not save step:', err.message));
  };
  const finish = async (result) => {
    if (runId) {
      await finishRun(runId, { outcome: 'done', llmCalls: 0, usage: {}, ms: Date.now() - started, ...result }).catch((err) =>
        console.error('[agent:doseDue] could not finish run:', err.message),
      );
    }
  };
  const call = async (reason) => {
    const { output, at, ms } = await timed(async () => {
      try {
        const ok = await placeCall();
        return ok === false ? { ok: false, error: 'call not placed' } : { ok: true, data: { channel: CHANNEL(), attempt } };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
    await log({ tool: 'place_call', input: { channel: CHANNEL(), attempt }, output, ms, at, approvalLevel: 0 });
    return { called: output.ok, reason, runId: runId ? String(runId) : null };
  };

  try {
    const reminder = givenReminder || (await findDueReminder(medicine, attempt, now));
    runId = await startRun({ trigger: 'dose_due', patientId: patient._id, reminderId: reminder && reminder._id, flow: 'dose' }).catch((err) => {
      console.error('[agent:doseDue] could not start run:', err.message);
      return null;
    });

    if (!reminder) {
      // No Reminder record to check against: call, as today.
      const r = await call('no_reminder_record');
      await finish({ text: `No reminder record for ${medicine.name}; placed the call without a double-dose check.` });
      return r;
    }

    const ctx = { patientId: String(patient._id), runId: runId ? String(runId) : undefined, flow: 'dose', now };
    const check = await timed(() => getTool('check_double_dose').run({ reminderId: String(reminder._id) }, ctx));
    await log({ tool: 'check_double_dose', input: { reminderId: String(reminder._id) }, output: check.output, ms: check.ms, at: check.at, approvalLevel: 0 });

    if (check.output.ok && check.output.data.alreadyTaken) {
      await finish({ text: `${medicine.name} is already recorded as taken. No call placed.` });
      return { called: false, reason: 'already_taken', runId: runId ? String(runId) : null };
    }

    const r = await call(check.output.ok ? 'not_taken' : 'check_failed');
    await finish({
      text: r.called ? `${medicine.name} not taken yet. Called the patient (${CHANNEL() === 'keypad' ? 'keypad menu' : 'speech agent'}).` : `${medicine.name} not taken yet. The call could not be placed.`,
      outcome: r.called ? 'done' : 'fallback',
      fallbackReason: r.called ? undefined : 'call_failed',
    });
    return r;
  } catch (err) {
    // Never leave a dose unreminded because of an agent problem.
    console.error('[agent:doseDue] handover failed, calling anyway:', err.message);
    const r = await call('handover_error');
    await finish({ outcome: 'fallback', fallbackReason: 'handover_error', error: { kind: 'crash', message: err.message } });
    return r;
  }
}

module.exports = { handleDoseDue, findDueReminder };
