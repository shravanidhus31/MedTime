const AgentRun = require('../models/AgentRun');
const Patient = require('../models/Patient');
const Reminder = require('../models/Reminder');
const Medicine = require('../models/Medicine');
const ProposedChange = require('../models/ProposedChange');
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

async function generateDailyJournal(patientId, targetDate = new Date()) {
  const patient = await Patient.findById(patientId);
  if (!patient) {
    throw new Error(`Patient ${patientId} not found`);
  }

  const { start, end, calendarDate } = getDayBoundsIST(targetDate);

  // 1. Fetch day's AgentRuns
  const runs = await AgentRun.find({
    patient: patientId,
    createdAt: { $gte: start, $lte: end },
  }).sort({ createdAt: 1 }).lean();

  // 2. Fetch day's Reminders
  const reminders = await Reminder.find({
    $or: [{ patient: patientId }, { user: patient.user }],
    time: { $gte: start, $lte: end },
  }).populate('medicine medication').lean();

  // 3. Fetch day's ProposedChanges
  const proposals = await ProposedChange.find({
    patient: patientId,
    createdAt: { $gte: start, $lte: end },
  }).lean();

  // 4. Check low stock medicines (refill alerts FR6)
  const lowStockMeds = await Medicine.find({
    patient: patientId,
    isActive: true,
    $expr: { $lte: ['$tabletCount', '$refillThreshold'] },
  }).lean();

  // 5. Create the Journal AgentRun audit record
  const journalRun = await AgentRun.create({
    trigger: 'journal',
    patient: patientId,
    flow: 'daily_journal',
    steps: [
      { step: 'collect_history', summary: `Found ${runs.length} runs, ${reminders.length} reminders, ${proposals.length} proposals` },
    ],
    status: 'running',
    model: process.env.LLM_MODEL_SMART || 'groq/llama-3.3-70b-versatile',
  });

  const rawLines = [];

  // ─── Priority 1: Attention items first ─────────────────────────────────────

  // Red flags from AgentRuns
  const redFlagRuns = runs.filter((r) => r.outcome === 'red_flag' || (r.steps && r.steps.some((s) => s.type === 'red_flag' || s.step === 'red_flag')));
  for (const rfRun of redFlagRuns) {
    const rfStep = rfRun.steps?.find((s) => s.type === 'red_flag' || s.step === 'red_flag');
    const category = rfStep?.output?.category || rfStep?.category || 'emergency red flag';
    rawLines.push({
      text: `Safety alert triggered: ${category}. Caregiver notified immediately in neutral voice.`,
      source: 'agent_noticed',
      runId: rfRun._id.toString(),
    });
  }

  // Missed doses
  const missedReminders = reminders.filter((r) => r.status === 'missed' || r.status === 'alerted');
  for (const r of missedReminders) {
    const medName = r.medicine?.name || r.medication?.name || 'Scheduled medication';
    const timeStr = r.time ? new Date(r.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '';
    const matchingRun = runs.find((run) => run.reminder && run.reminder.toString() === r._id.toString()) || journalRun;
    rawLines.push({
      text: `Missed scheduled dose of ${medName}${timeStr ? ` at ${timeStr}` : ''}. Escalation completed.`,
      source: 'action_taken',
      runId: matchingRun._id.toString(),
    });
  }

  // Pending proposals waiting for approval
  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  for (const p of pendingProposals) {
    rawLines.push({
      text: `Medication schedule change (${p.kind.replace(/_/g, ' ')}) waiting for caregiver approval.`,
      source: 'action_taken',
      runId: (p.createdByRun || journalRun._id).toString(),
    });
  }

  // Low stock / refill alert lines
  for (const med of lowStockMeds) {
    const dailyDoses = (med.scheduledTimes && med.scheduledTimes.length) || 1;
    const daysLeft = Math.max(1, Math.floor((med.tabletCount || 0) / dailyDoses));
    rawLines.push({
      text: `About ${daysLeft} days of ${med.name} left in stock (${med.tabletCount} tablets remaining; refill recommended).`,
      source: 'agent_noticed',
      runId: journalRun._id.toString(),
    });
  }

  // ─── Priority 2: Interaction quotes & behavioral observations ─────────────

  // Patient quotes from phone/simulator runs
  for (const run of runs) {
    if (rawLines.length >= 7) break;
    const speechSteps = (run.steps || []).filter((s) => s.step === 'patient_speech' || s.type === 'patient_speech' || (s.summary && s.summary.startsWith('Patient said')));
    for (const step of speechSteps) {
      if (rawLines.length >= 7) break;
      let quote = step.summary ? step.summary.replace(/^Patient said:?\s*/i, '') : step.output?.text;
      if (quote && quote.length > 5) {
        // Shorten long quotes to under 80 chars
        if (quote.length > 80) quote = quote.substring(0, 77) + '...';
        rawLines.push({
          text: `Patient said: "${quote.replace(/"/g, '')}"`,
          source: 'patient_said',
          runId: run._id.toString(),
        });
      }
    }
  }

  // ─── Priority 3: Routine / Adherence status ────────────────────────────────

  const takenReminders = reminders.filter((r) => r.status === 'taken');
  if (takenReminders.length > 0 && missedReminders.length === 0) {
    const medNames = [...new Set(takenReminders.map((r) => r.medicine?.name || r.medication?.name).filter(Boolean))].join(', ');
    rawLines.push({
      text: `All scheduled doses taken on time (${medNames || `${takenReminders.length} doses`}). Patient had a calm day.`,
      source: 'agent_noticed',
      runId: (takenReminders[0] ? runs.find((run) => run.reminder?.toString() === takenReminders[0]._id.toString()) : null)?._id?.toString() || journalRun._id.toString(),
    });
  }

  // ─── Priority 4: Quiet day fallback (Rule: quiet days get 1 line) ──────────

  if (rawLines.length === 0) {
    rawLines.push({
      text: 'Routine quiet day with no intervention required; all scheduled care completed peacefully.',
      source: 'agent_noticed',
      runId: journalRun._id.toString(),
    });
  }

  // Cap at 8 lines per entry (PRD / Contract rule: 1 to 8 lines)
  const finalLines = rawLines.slice(0, 8);

  // 6. Write journal using the write_journal tool
  const result = await writeJournal.run(
    {
      date: calendarDate.toISOString(),
      lines: finalLines,
    },
    {
      patientId: patientId.toString(),
      runId: journalRun._id.toString(),
    }
  );

  if (!result.ok) {
    journalRun.status = 'failed';
    journalRun.outcome = `Journal tool failed: ${result.error}`;
    await journalRun.save();
    throw new Error(`Failed to write journal: ${result.error}`);
  }

  journalRun.status = 'completed';
  journalRun.outcome = `Journal generated with ${finalLines.length} lines`;
  journalRun.steps.push({
    step: 'write_journal',
    output: { journalId: result.journalId, lineCount: result.lineCount },
  });
  await journalRun.save();

  return result;
}

module.exports = {
  getDayBoundsIST,
  generateDailyJournal,
};
