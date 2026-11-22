// Live check of step-by-step guided medicine-taking (Feature 4, A6.1).
// Gates: on/off per patient; 3-5 steps from her medicine's details; done → praise + next step;
// trouble → a simpler version; two misses on one step → hand over to the family; then the usual
// check question before recording; the double-dose rules still apply mid-steps; a question gets the
// same step again; Hindi; time per step and corrections measured for the weekly review.
// No model (rules only). Uses your dev database; Twilio off; deletes its test data.
// Run from server/:  npm run steps:check

require('dotenv').config({ quiet: true });
for (const v of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'RENDER']) delete process.env[v];
process.env.TWILIO_ENABLED = 'false';
process.env.LLM_PROVIDER = 'none';
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'development';

const dbName = (() => { try { return new URL(process.env.MONGO_URI).pathname.replace(/^\//, ''); } catch { return ''; } })();
if (!dbName || !/dev|test/i.test(dbName)) {
  console.error(`Refusing to run: MONGO_URI database is "${dbName || '(none)'}". Use a dev database such as medtime_dev_a.`);
  process.exit(1);
}

const mongoose = require('mongoose');
const { initAgent } = require('../agent');
initAgent();
const { handleTurn } = require('../agent/orchestrator');
const { startDoseCall } = require('../agent/flows/dose');
const M = (n) => require(`../models/${n}`);
const [User, Patient, Medicine, Reminder, AgentRun, CaregiverAlert, CaregiverAccess, Observation, FollowUp, AgentQuestion] = ['User', 'Patient', 'Medicine', 'Reminder', 'AgentRun', 'CaregiverAlert', 'CaregiverAccess', 'Observation', 'FollowUp', 'AgentQuestion'].map(M);

const TAG = `steps-check-${Date.now()}`;
const results = [];
const check = (name, passed, detail = '') => {
  results.push(!!passed);
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${String(detail).slice(0, 230)})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spoken = (a) => (a || []).filter((x) => x.text).map((x) => x.text).join(' ');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  console.log(`Connected to ${mongoose.connection.name} (Twilio off, no model)\n`);
  const made = { users: [], patients: [], medicines: [] };
  try {
    const n = String(Date.now()).slice(-7);
    const mk = async (label, language, guidedSteps) => {
      const u = await User.create({ name: `${label} ${TAG}`, phone: `+9184${n}${made.users.length}`, passwordHash: 'x', role: 'patient' });
      const cg = await User.create({ name: `Priya ${TAG}`, phone: `+9185${n}${made.users.length}`, passwordHash: 'x', role: 'caregiver' });
      made.users.push(u._id, cg._id);
      const p = await Patient.create({ user: u._id, emergencyContact: '+910000000081', dementiaMode: true, language, guidedSteps });
      made.patients.push(p._id);
      await CaregiverAccess.create({ patient: p._id, user: cg._id, role: 'primary', status: 'active', approvedAt: new Date() });
      const med = await Medicine.create({ patient: p._id, name: 'Amlodipine', dosage: '5mg', type: 'tablet', frequency: 'once', scheduledTimes: ['08:00'], pillDescription: 'small white round tablet', pillboxSlot: 'Morning, slot 1', locationHint: 'kitchen table', mealTiming: 'with', startDate: new Date(Date.now() - 864e5), notificationType: 'call' });
      made.medicines.push(med._id);
      return { p, med };
    };
    const call = async ({ p, med }, lines) => {
      const d = await Reminder.create({ medicine: med._id, patient: p._id, scheduledTime: new Date(Date.now() - 2 * 60000), status: 'pending', attempts: 1 });
      const c = await startDoseCall({ reminderId: d._id, trigger: 'simulate', channel: 'text' });
      const said = [spoken(c.actions)];
      let ended = false;
      for (const l of lines) {
        if (ended) break;
        const r = await handleTurn({ sessionId: c.sessionId, transcript: l, isFinal: true });
        said.push(spoken(r.actions));
        ended = r.actions.some((a) => a.type === 'hangup');
      }
      await sleep(700);
      return { said, ended, dose: await Reminder.findById(d._id).lean(), runId: c.runId };
    };

    // 1. off by default → the usual one-line reminder
    const off = await mk('Asha', 'en', false);
    const c0 = await call(off, []);
    check('guidance OFF (default): the usual reminder, no steps', /Can you take it now/.test(c0.said[0]) && !/one step at a time/.test(c0.said[0]), c0.said[0]);

    // 2. on: 5 steps from her details, each done → praise + next; then the check question; recorded
    const on = await mk('Kamala', 'en', true);
    const c1 = await call(on, ["I'm there.", 'Okay, it is open.', 'Yes, I have a biscuit.', 'I have the water.', 'Done.', 'The small white round one.']);
    check('step 1 with the greeting: "Let\'s do it together, one step at a time. First, go to the kitchen table."', /one step at a time\. First, go to the kitchen table\./.test(c1.said[0]), c1.said[0]);
    check('"Good." + the next step each time: pillbox → food (with food) → water → swallow',
      /Good\. Open your pillbox: Morning, slot 1/.test(c1.said[1]) && /Good\. This one is taken with food/.test(c1.said[2]) && /Good\. Now pour a glass of water/.test(c1.said[3]) && /Good\. Put the tablet in your mouth/.test(c1.said[4]), c1.said.slice(1, 5).join(' | '));
    check('after the last step: the check question; the right pill → recorded and praised',
      /Which tablet did you take\?/.test(c1.said[5]) && /That's right\. Well done/.test(c1.said[6]) && c1.dose.status === 'taken' && c1.dose.confirmedBy === 'agent', `${c1.said[5]} | ${c1.said[6]}`);
    const obs1 = Object.fromEntries((await Observation.find({ callId: c1.runId }).lean()).map((o) => [o.metric, o.value]));
    const run1 = await AgentRun.findById(c1.runId).lean();
    check('measured for the weekly review: 0 corrections, seconds per step; the plan and each step are on the run',
      obs1.stepCorrections === 0 && typeof obs1.stepSeconds === 'number' && run1.steps.filter((s) => s.tool === 'guided_step').length === 5 && run1.steps.some((s) => s.tool === 'plan_steps'), JSON.stringify(obs1));

    // 3. trouble once → a simpler version; then done
    const c2 = await call(on, ["I'm there.", "I can't find the box.", 'Got it, it is open.', 'Yes.', 'Yes.', 'Done.', 'The small white one.']);
    check('trouble → "That\'s all right. Let\'s try it this way." + the simpler step; then carries on and records',
      /That's all right\. Let's try it this way\. Find the part of your pillbox marked Morning, slot 1/.test(c2.said[2]) && c2.dose.status === 'taken', c2.said[2]);

    // 4. two misses on one step → hand over to the family; nothing recorded
    const c3 = await call(on, ["I'm there.", "I don't know where it is.", 'I still cannot find it.']);
    const alerts = await CaregiverAlert.find({ patient: on.p._id }).lean();
    check('two misses on one step → "Priya will call you soon to help… Don\'t take anything until then", the family is phoned with the step, nothing recorded',
      /will call you soon to help/.test(c3.said[3]) && c3.ended && c3.dose.status !== 'taken' && alerts.some((a) => /stuck at opening the pillbox/.test(a.message)), alerts.map((a) => a.message).join(' | '));

    // 5. the double-dose rules still apply mid-steps
    const c4 = await call(on, ['I already took it this morning.']);
    check('"I already took it" during the steps → the log decides: not recorded → "Please don\'t take another one", family asked',
      /Please don't take another one/.test(c4.said[1]) && c4.ended, c4.said[1]);

    // 6. Hindi
    const hi = await mk('Sita', 'hi', true);
    const c5 = await call(hi, ['हाँ, पहुँच गई।', 'खोल दिया।']);
    check('Hindi: "चलिए, एक-एक कदम करके साथ में करते हैं। पहले kitchen table के पास जाइए।" then "बहुत अच्छा।" + the next step',
      /एक-एक कदम करके/.test(c5.said[0]) && /पहले kitchen table के पास जाइए/.test(c5.said[0]) && /बहुत अच्छा। अपना पिलबॉक्स खोलिए/.test(c5.said[1]), `${c5.said[0]} | ${c5.said[1]}`);
  } catch (err) {
    check('check ran without crashing', false, err.stack);
  } finally {
    await sleep(500);
    for (const Mod of [Observation, FollowUp, AgentQuestion, CaregiverAlert, CaregiverAccess, AgentRun, Reminder]) await Mod.deleteMany({ patient: { $in: made.patients } });
    await Medicine.deleteMany({ _id: { $in: made.medicines } });
    await Patient.deleteMany({ _id: { $in: made.patients } });
    await User.deleteMany({ _id: { $in: made.users } });
    await mongoose.disconnect();
    const passed = results.filter(Boolean).length;
    console.log(`\n${passed}/${results.length} passed (test data deleted)`);
    process.exit(passed === results.length ? 0 : 1);
  }
})();
