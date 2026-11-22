// Live check of the daily care journal (Feature 6, B8) on a seeded day, against the PRD gate:
// "on a seeded day with one missed dose and one red flag, the note lists both first, each linked to
// its run; no line appears without a source". Also: "Patient said" lines quote the transcript, and
// a refill line appears at the threshold. Uses your dev database; deletes its test data.
// Run from server/:  npm run journal:check

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RENDER']) delete process.env[v];
process.env.TWILIO_ENABLED = 'false';

const dbName = (() => {
  try {
    return new URL(process.env.MONGO_URI).pathname.replace(/^\//, '');
  } catch {
    return '';
  }
})();
if (!dbName || !/dev|test/i.test(dbName)) {
  console.error(`Refusing to run: MONGO_URI database is "${dbName || '(none)'}". Use a dev database such as medtime_dev_a.`);
  process.exit(1);
}

const mongoose = require('mongoose');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const AgentRun = require('../models/AgentRun');
const JournalEntry = require('../models/JournalEntry');
const { generateDailyJournal } = require('../services/journalService');

const TAG = `journal-check-${Date.now()}`;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name}\n`);
  const made = { users: [], patients: [], medicines: [] };
  try {
    const u = await User.create({ name: `Kamala ${TAG}`, phone: `+9195${String(Date.now()).slice(-7)}`, passwordHash: 'x', role: 'patient' });
    made.users.push(u._id);
    const patient = await Patient.create({ user: u._id, emergencyContact: '+910000000009', dementiaMode: true });
    made.patients.push(patient._id);
    const aml = await Medicine.create({ patient: patient._id, name: 'Amlodipine', dosage: '5mg', type: 'tablet', frequency: 'twice', scheduledTimes: ['08:00', '20:00'], startDate: new Date(), tabletCount: 4, refillThreshold: 5 });
    made.medicines.push(aml._id);

    // the seeded day (IST): an 08:00 dose taken on a dose call, a 14:00 dose missed, a red flag at 17:00
    const now = new Date();
    const ist = new Date(now.getTime() + 5.5 * 3600000);
    const at = (h) => new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, 0) - 5.5 * 3600000);
    const taken = await Reminder.create({ medicine: aml._id, patient: patient._id, scheduledTime: at(8), status: 'taken', confirmedBy: 'agent', confirmedAt: at(8.1) });
    const missed = await Reminder.create({ medicine: aml._id, patient: patient._id, scheduledTime: at(14), status: 'missed', caregiverAlerted: true });
    // runs as the dose agent writes them (contract C2)
    const step = (tool, extra) => ({ tool, at: at(8), ms: 0, ...extra });
    const doseRun = await AgentRun.create({
      trigger: 'dose_due', patient: patient._id, reminder: taken._id, flow: 'dose', status: 'finished', outcome: 'done', startedAt: at(8), createdAt: at(8),
      steps: [
        step('patient_said', { input: { text: 'Yes, I have taken it with my breakfast.' }, label: 'patient_said', summaryText: 'Yes, I have taken it with my breakfast.' }),
        step('mark_dose', { input: { status: 'taken' }, output: { ok: true } }),
      ],
    });
    const missedRun = await AgentRun.create({ trigger: 'dose_due', patient: patient._id, reminder: missed._id, flow: 'dose', status: 'finished', outcome: 'done', startedAt: at(14), createdAt: at(14), steps: [step('place_call', { output: { ok: true } })] });
    const redRun = await AgentRun.create({
      trigger: 'simulate', patient: patient._id, flow: 'dose', status: 'finished', outcome: 'red_flag', fallbackReason: 'fall', startedAt: at(17), createdAt: at(17),
      steps: [
        step('patient_said', { input: { text: 'I have fallen down in the bathroom.' }, label: 'patient_said' }),
        step('safety_screen', { input: { transcript: 'I have fallen down in the bathroom.' }, output: { verdict: 'redflag', category: 'fall' } }),
      ],
    });

    let journal;
    let error;
    try {
      await generateDailyJournal(patient._id, now);
      journal = await JournalEntry.findOne({ patient: patient._id }).sort({ createdAt: -1 }).lean();
    } catch (err) {
      error = err;
    }
    check('the journal is written for the day', journal && journal.lines && journal.lines.length > 0, error ? `error: ${error.message}` : `${journal ? journal.lines.length : 0} lines`);
    const lines = (journal && journal.lines) || [];
    for (const l of lines) console.log(`   [${l.source}] ${l.text}  (run ${l.runId || '-'})`);

    const first2 = lines.slice(0, 2);
    const redLine = lines.find((l) => /fall|red flag|safety/i.test(l.text));
    const missedLine = lines.find((l) => /missed|not confirmed/i.test(l.text));
    check('PRD gate: the red flag and the missed dose are listed first', first2.includes(redLine) && first2.includes(missedLine));
    check('PRD gate: each is linked to its own run', redLine && String(redLine.runId) === String(redRun._id) && missedLine && String(missedLine.runId) === String(missedRun._id));
    check('PRD gate: no line without a source (source + run)', lines.length > 0 && lines.every((l) => l.source && l.runId));
    const quote = lines.find((l) => l.source === 'patient_said' && String(l.runId) === String(doseRun._id));
    check('"Patient said" quotes her words from the dose call, not a paraphrase', quote && /Yes, I have taken it with my breakfast/.test(quote.text) && String(quote.runId) === String(doseRun._id), quote && quote.text);
    check('refill line at the threshold (4 tablets, 2 a day)', lines.some((l) => /About 2 days of Amlodipine left/.test(l.text)));
    check('no diagnosis words', !lines.some((l) => /declin|dementia|diagnos|worse/i.test(l.text)));
    const fallQuote = lines.find((l) => l.source === 'patient_said' && String(l.runId) === String(redRun._id));
    check('the red flag comes with her exact words, right after the attention items', fallQuote && /I have fallen down in the bathroom/.test(fallQuote.text) && lines.indexOf(fallQuote) === 2);
    const jr = await AgentRun.findOne({ patient: patient._id, trigger: 'journal' }).lean();
    check('the journal run is saved and finished (it used to fail validation)', jr && jr.status === 'finished' && jr.steps.some((st) => st.tool === 'write_journal'));
  } catch (err) {
    check('check ran without crashing', false, err.stack);
  } finally {
    await JournalEntry.deleteMany({ patient: { $in: made.patients } });
    await AgentRun.deleteMany({ patient: { $in: made.patients } });
    await Reminder.deleteMany({ patient: { $in: made.patients } });
    await Medicine.deleteMany({ _id: { $in: made.medicines } });
    await Patient.deleteMany({ _id: { $in: made.patients } });
    await User.deleteMany({ _id: { $in: made.users } });
    await mongoose.disconnect();
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed (test data deleted)`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
