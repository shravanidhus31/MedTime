// Seeds 6 weeks of DEMO call measures for one patient, so the weekly review can be shown without
// waiting 6 weeks (PRD demo plan: "the weekly review flagging a seeded change and a sundowning
// proposal awaiting approval"). Every row is marked metadata.seeded, the review says "Includes
// seeded demo data", and no quotes are seeded (quotes only ever come from her real calls).
//
//   node scripts/seed-weekly-demo.js 8169003080            seed, then run the review once
//   node scripts/seed-weekly-demo.js 8169003080 --remove   remove the seeded rows and seeded reviews
//
// What it seeds: weekly chats (MTLD etc.) usual for 4 weeks, then narrower for 2; mornings normal for
// 4 weeks, then 2 weeks of more "say that again" (a change that
// the review asks the caregiver about before flagging); evenings with distress words in each of the
// last 3 weeks (sundowning → a proposal to call 30 min earlier, if she has an evening Call medicine).
// Uses MONGO_URI from server/.env; for the live app set it in the terminal for that one command
// (Render → Environment) and close the terminal afterwards.

require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const phone = String(process.argv[2] || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
const REMOVE = process.argv.includes('--remove');
if (!/^\d{10}$/.test(phone)) {
  console.error('Usage: node scripts/seed-weekly-demo.js <patient 10-digit phone> [--remove]');
  process.exit(1);
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const User = require('../models/User');
  const Patient = require('../models/Patient');
  const Observation = require('../models/Observation');
  const WeeklyReview = require('../models/WeeklyReview');
  const user = await User.findOne({ phone: { $in: [phone, `+91${phone}`, `91${phone}`] } });
  const patient = user && (await Patient.findOne({ user: user._id }));
  if (!patient) { console.error(`No patient with phone ${phone} in "${mongoose.connection.name}".`); await mongoose.disconnect(); process.exit(1); }

  const removed = await Observation.deleteMany({ patient: patient._id, 'metadata.seeded': true });
  const removedReviews = await WeeklyReview.deleteMany({ patient: patient._id, seeded: true });
  if (REMOVE) {
    console.log(`Removed ${removed.deletedCount} seeded measure(s) and ${removedReviews.deletedCount} seeded review(s) for ${user.name}.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  const DAY = 24 * 3600 * 1000;
  const now = new Date();
  const at = (daysAgo, hourIst) => { const x = new Date(now.getTime() - daysAgo * DAY + 5.5 * 3600000); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate(), hourIst, 0) - 5.5 * 3600000); };
  const rows = [];
  const call = (daysAgo, hourIst, m) => {
    const callId = new mongoose.Types.ObjectId(); // no real call behind it: marked seeded
    const block = hourIst < 12 ? 'morning' : hourIst < 17 ? 'afternoon' : hourIst < 21 ? 'evening' : 'night';
    for (const [metric, value] of Object.entries(m)) rows.push({ patient: patient._id, callId, callType: 'phone', source: 'code', metric, value, timeOfDay: block, timestamp: at(daysAgo, hourIst), metadata: { seeded: true, version: 'demo-seed@1' } });
  };
  // her first 4 weeks: mornings, about one "say that again" every other call
  for (let i = 0; i < 12; i += 1) call(42 - i * 2, 9, { clarificationCount: i % 2, fillersCount: 1, turnLengthWords: 7, unclearTurns: 0, asrConfidence: 0.9 });
  // the last 2 weeks: mornings with more "say that again"
  for (const [d, c] of [[13, 3], [11, 2], [9, 3], [6, 3], [4, 4], [2, 3]]) call(d, 9, { clarificationCount: c, fillersCount: 1, turnLengthWords: 7, unclearTurns: 1, asrConfidence: 0.89 });
  // evenings: distress words in each of the last 3 weeks
  for (const d of [19, 16, 10, 8, 3, 1]) call(d, 20, { sundowningAnxietyCount: 1, unclearTurns: 2, turnLengthWords: 4, asrConfidence: 0.87 });
  // weekly chats (the speech-screening paper's measures): 4 usual Sundays, then 2 with a narrower
  // range of words
  const chat = (daysAgo, mtld, cttr, hdd) => {
    const callId = new mongoose.Types.ObjectId();
    for (const [metric, value] of Object.entries({ mtld, cttr, hdd, brunetW: 9.5, wordCount: 72, fillersCount: 1, repeatedPhrasesCount: 0 })) {
      rows.push({ patient: patient._id, callId, callType: 'chat', source: 'code', metric, value, timeOfDay: 'morning', timestamp: at(daysAgo, 11), metadata: { seeded: true, flow: 'chat', version: 'demo-seed@1' } });
    }
  };
  for (const d of [41, 34, 27, 20]) chat(d, 82, 4.6, 0.84);
  chat(13, 58, 3.8, 0.79);
  chat(6, 54, 3.6, 0.78);
  await Observation.insertMany(rows);
  console.log(`Seeded ${rows.length} demo measure(s) (${new Set(rows.map((r) => String(r.callId))).size} calls) for ${user.name} in "${mongoose.connection.name}".`);

  const { generateWeeklyReview } = require('../services/weeklyReviewService');
  const review = await generateWeeklyReview(patient._id, now);
  console.log('\nWeekly review:');
  for (const l of review.summaryLines) console.log(`  [${l.kind}] ${l.text}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
