const AgentRun = require('../models/AgentRun');
const Patient = require('../models/Patient');
const Reminder = require('../models/Reminder');
const Medicine = require('../models/Medicine');
const ProposedChange = require('../models/ProposedChange');
const AgentQuestion = require('../models/AgentQuestion');
const writeJournal = require('../agent/tools/writeJournal');

/**
 * Journal Service — Feature 6 (B8)
 *
 * Runs nightly at 9:00 PM IST (15:30 UTC) or on demand.
 * Collects 24 hours of AgentRuns, Reminders, and Proposals,
 * and synthesizes 3-8 lines of structured care notes.
 *
 * Attention items go first:
 * - Missed doses
 * - Red flags
 * - Approvals waiting
 * - Refill alerts
 *
 * Rules:
 * - Every line links to its source runId or observationId.
 * - "patient_said" lines quote transcripts, shortened, never paraphrased.
 * - No diagnosis, no "declining", no guessing at causes.
 * - Quiet days get 1 line.
 */

function getDayBoundsIST(targetDate = new Date()) {
  const d = new Date(targetDate);
  // IST is UTC + 5:30.
  // Today midnight IST is UTC date with offset -5h30m
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(d.getTime() + istOffset);

  const startIST = new Date(Date.UTC(istTime.getUTCFullYear(), istTime.getUTCMonth(), istTime.getUTCDate(), 0, 0, 0, 0));
  const endIST = new Date(Date.UTC(istTime.getUTCFullYear(), istTime.getUTCMonth(), istTime.getUTCDate(), 23, 59, 59, 999));

  return {
    start: new Date(startIST.getTime() - istOffset),
    end: new Date(endIST.getTime() - istOffset),
    calendarDate: startIST,
  };
}

// IST clock time, e.g. "8:05 PM".
function istTime(date) {
  const d = new Date(new Date(date).getTime() + 5.5 * 3600 * 1000);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const RED_FLAG_WORDS = {
  fall: 'a fall', chest_pain: 'chest pain', breathing: 'trouble breathing', breathlessness: 'trouble breathing',
  extra_pills: 'extra pills taken', self_harm: 'talk of self-harm', scam: 'a request for money or codes',
  financial_scam: 'a request for money or codes', sudden_confusion: 'signs of a stroke', help_key: 'the help key',
};

// Her own words from a run: dose calls ({ tool: 'patient_said', input.text }) and the older
// call-in shape (summary "Patient said: ...").
function patientWords(run) {
  const out = [];
  for (const s of run.steps || []) {
    if (s.tool === 'patient_said' && s.input && s.input.text) out.push(String(s.input.text));
    else if (/^Patient said:/i.test(s.summaryText || s.summary || '')) out.push(String(s.summaryText || s.summary).replace(/^Patient said:\s*"?|"$/gi, ''));
  }
  return out.map((t) => t.trim()).filter(Boolean);
}

// The red flag in a run, if any: { category, words }.
function redFlagOf(run) {
  const step = (run.steps || []).find((s) => s.tool === 'safety_screen' && s.output && s.output.verdict === 'redflag');
  if (!step && run.outcome !== 'red_flag') return null;
  const category = (step && step.output.category) || run.fallbackReason || 'red flag';
  return { category, words: step && step.input && step.input.transcript };
}

const shorten = (t, n = 90) => (t.length > n ? `${t.slice(0, n - 3).trim()}...` : t);

/**
 * Builds and saves the day's journal for one patient (Feature 6, B8; rewritten in the 22 Nov review:
 * the old version crashed on save, looked up doses by a field that doesn't exist, and never found
 * the patient's words). Every line is assembled from a record of the day, so it always has a
 * source and quotes are exact; nothing is paraphrased or diagnosed.
 */
async function generateDailyJournal(patientId, targetDate = new Date()) {
  const patient = await Patient.findById(patientId);
  if (!patient) throw new Error(`Patient ${patientId} not found`);
  const { start, end, calendarDate } = getDayBoundsIST(targetDate);

  const runs = await AgentRun.find({ patient: patientId, trigger: { $ne: 'journal' }, startedAt: { $gte: start, $lte: end } })
    .sort({ startedAt: 1 }).lean();
  const reminders = await Reminder.find({ patient: patientId, scheduledTime: { $gte: start, $lte: end } })
    .sort({ scheduledTime: 1 }).populate('medicine', 'name').lean();
  const proposals = await ProposedChange.find({ patient: patientId, status: 'pending' }).lean();
  const questions = await AgentQuestion.find({ patient: patientId, status: 'pending' }).lean();
  const lowStock = await Medicine.find({ patient: patientId, isActive: true, $expr: { $lte: ['$tabletCount', '$refillThreshold'] } }).lean();

  const journalRun = await AgentRun.create({
    trigger: 'journal', patient: patientId, flow: 'daily_journal', status: 'running',
    steps: [{ tool: 'collect_day', at: new Date(), output: { runs: runs.length, doses: reminders.length, proposals: proposals.length, questions: questions.length } }],
  });
  const runFor = (reminderId) => runs.slice().reverse().find((r) => r.reminder && String(r.reminder) === String(reminderId));
  const src = (run) => String((run && run._id) || journalRun._id);
  const attention = []; // headlines: red flags, missed / unconfirmed doses, approvals, questions
  const attentionQuotes = []; // her words behind a red flag, right after the headlines
  const rest = [];

  // ── attention items first ──
  for (const run of runs) {
    const flag = redFlagOf(run);
    if (!flag) continue;
    const what = RED_FLAG_WORDS[flag.category] || String(flag.category).replace(/_/g, ' ');
    attention.push({ text: `Red flag on a call at ${istTime(run.startedAt)}: ${what}. The family was phoned at once.`, source: 'agent_noticed', runId: src(run) });
    if (flag.words) attentionQuotes.push({ text: `Patient said: "${shorten(flag.words)}"`, source: 'patient_said', runId: src(run) });
  }
  const now = new Date();
  for (const r of reminders) {
    const name = (r.medicine && r.medicine.name) || 'a medicine';
    if (r.status === 'missed') {
      attention.push({ text: `${name} at ${istTime(r.scheduledTime)} was missed${r.caregiverAlerted ? '; the family was phoned' : ''}.`, source: 'action_taken', runId: src(runFor(r._id)) });
    } else if ((r.status === 'pending' || r.status === 'alerted') && r.scheduledTime < now && (r.attempts || 0) > 0) {
      attention.push({ text: `${name} at ${istTime(r.scheduledTime)} was not confirmed.`, source: 'agent_noticed', runId: src(runFor(r._id)) });
    }
  }
  for (const p of proposals) {
    attention.push({ text: `A ${String(p.kind).replace(/_/g, ' ')} is waiting for your approval.`, source: 'action_taken', runId: String(p.createdByRun || journalRun._id) });
  }
  for (const q of questions) {
    attention.push({ text: `Question for you: ${shorten(q.question, 120)}`, source: 'action_taken', runId: String(q.run || journalRun._id) });
  }

  // ── then refills, her words, the doses, patterns ──
  for (const med of lowStock) {
    const perDay = (med.scheduledTimes && med.scheduledTimes.length) || 1;
    rest.push({ text: `About ${Math.max(0, Math.floor((med.tabletCount || 0) / perDay))} days of ${med.name} left (${med.tabletCount} tablets).`, source: 'agent_noticed', runId: src(null) });
  }
  const quoted = new Set(attentionQuotes.map((l) => l.text));
  const said = [];
  for (const run of runs) {
    if (redFlagOf(run)) continue;
    for (const w of patientWords(run)) if (w.split(/\s+/).length >= 4) said.push({ w, run });
  }
  for (const { w, run } of said.slice(-2)) {
    const text = `Patient said: "${shorten(w)}"`;
    if (!quoted.has(text)) rest.push({ text, source: 'patient_said', runId: src(run) });
  }
  const taken = reminders.filter((r) => r.status === 'taken');
  if (taken.length) {
    const list = taken.map((r) => `${(r.medicine && r.medicine.name) || 'medicine'} ${istTime(r.scheduledTime)}`).join(', ');
    rest.push({ text: `Taken: ${list}.`, source: 'action_taken', runId: src(runFor(taken[0]._id)) });
  }
  const callins = runs.filter((r) => r.trigger === 'callin');
  if (callins.length >= 3) {
    rest.push({ text: `Called in ${callins.length} times today to ask about medicines.`, source: 'agent_noticed', runId: src(callins[callins.length - 1]) });
  }

  let lines = [...attention, ...attentionQuotes, ...rest].slice(0, 8);
  if (lines.length === 0) {
    lines = [{ text: 'A quiet day: no calls or doses needed attention.', source: 'agent_noticed', runId: src(null) }];
  }

  const result = await writeJournal.run({ date: calendarDate.toISOString(), lines }, { patientId: String(patientId), runId: String(journalRun._id) });
  journalRun.steps.push({ tool: 'write_journal', at: new Date(), input: { lines: lines.length }, output: result });
  journalRun.endedAt = new Date();
  if (!result.ok) {
    journalRun.status = 'failed';
    journalRun.outcome = `Journal tool failed: ${result.error}`;
    await journalRun.save();
    throw new Error(`Failed to write journal: ${result.error}`);
  }
  journalRun.status = 'finished';
  journalRun.outcome = 'done';
  journalRun.text = `Journal written with ${lines.length} line(s).`;
  await journalRun.save();
  return result;
}

module.exports = {
  getDayBoundsIST,
  generateDailyJournal,
};
