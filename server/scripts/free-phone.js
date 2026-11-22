// Frees a phone number held by an old account, so it can be registered again (e.g. as a caregiver).
// Run it yourself, in your own terminal:
//
//   cd server
//   node scripts/free-phone.js 9326450209            archive (default, nothing deleted)
//   node scripts/free-phone.js 9326450209 --delete   delete the account and its own data, for good
//
// It uses MONGO_URI from server/.env (your dev database). For the live app, set MONGO_URI to the
// live database for that one command (Render → Environment), e.g. in PowerShell:
//   $env:MONGO_URI = '<live MONGO_URI>'; node scripts/free-phone.js 9326450209
// then close that terminal. Never paste the URI into a chat.
//
// Archive: the account's phone becomes "<phone>-old-<date>", so the number is free; the account can
// no longer log in, and everything it owns is kept. --delete: the account, its patient profile and
// that patient's medicines, doses, call records, alerts, journal, notes, follow-ups, proposals and
// caregiver links are deleted; this cannot be undone. Either way you see what is linked first and
// must type the phone number to confirm.

require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');

const phone = String(process.argv[2] || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
const DELETE = process.argv.includes('--delete');
if (!/^\d{10}$/.test(phone)) {
  console.error('Usage: node scripts/free-phone.js <10-digit phone number> [--delete]');
  process.exit(1);
}

const ask = (q) => new Promise((resolve) => {
  process.stdout.write(q);
  process.stdin.resume();
  process.stdin.once('data', (d) => { process.stdin.pause(); resolve(String(d).trim()); });
});

(async () => {
  const dbName = (() => { try { return new URL(process.env.MONGO_URI).pathname.replace(/^\//, '') || '(default)'; } catch { return '(none)'; } })();
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const M = (name) => require(`../models/${name}`);
  const User = M('User');
  const user = await User.findOne({ phone: { $in: [phone, `+91${phone}`, `91${phone}`] } });
  if (!user) {
    console.log(`No account uses ${phone} in database "${dbName}". It is already free to register.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  // What is linked to it
  const patient = await M('Patient').findOne({ user: user._id });
  const pid = patient ? patient._id : null;
  const count = async (name, q) => (q ? M(name).countDocuments(q) : 0);
  const linked = {
    'patient profile': patient ? 1 : 0,
    medicines: await count('Medicine', pid && { patient: pid }),
    doses: await count('Reminder', pid && { patient: pid }),
    'call records': await count('AgentRun', pid && { patient: pid }),
    'caregiver links (as patient)': await count('CaregiverAccess', pid && { patient: pid }),
    'caregiver links (as caregiver)': await count('CaregiverAccess', { user: user._id }),
    'caregiver alerts': await count('CaregiverAlert', pid && { patient: pid }),
    'journal entries': await count('JournalEntry', pid && { patient: pid }),
    'life notes': await count('LifeNote', pid && { patient: pid }),
    'follow-ups': await count('FollowUp', pid && { patient: pid }),
    proposals: await count('ProposedChange', pid && { patient: pid }),
    vitals: await count('Vital', { patientId: user._id }),
  };
  console.log(`\nDatabase "${dbName}": ${user.name} (${user.role}), phone ${user.phone}, registered ${user.createdAt ? user.createdAt.toISOString().slice(0, 10) : '?'}`);
  for (const [k, v] of Object.entries(linked)) if (v) console.log(`   ${k}: ${v}`);
  console.log(DELETE
    ? '\nThis will DELETE the account and everything listed above. It cannot be undone.'
    : `\nThis will ARCHIVE the account: its phone becomes "${phone}-old-…", so ${phone} is free to register. Nothing is deleted; the old account can no longer log in.`);

  const typed = await ask(`Type the phone number ${phone} to confirm: `);
  if (typed.replace(/\D/g, '') !== phone) { console.log('Nothing changed.'); await mongoose.disconnect(); process.exit(0); }

  if (!DELETE) {
    const archived = `${phone}-old-${new Date().toISOString().slice(0, 10)}-${String(user._id).slice(-4)}`;
    await User.updateOne({ _id: user._id }, { $set: { phone: archived, refreshToken: null } });
    console.log(`Archived. The old account's phone is now "${archived}". ${phone} can be registered again.`);
  } else {
    if (pid) {
      for (const name of ['Reminder', 'AgentRun', 'CaregiverAlert', 'JournalEntry', 'LifeNote', 'FollowUp', 'ProposedChange', 'AgentQuestion', 'Observation', 'WeeklyReview', 'RoutineProfile']) {
        await M(name).deleteMany({ patient: pid }).catch(() => {});
      }
      await M('Medicine').deleteMany({ patient: pid });
      await M('CaregiverAccess').deleteMany({ patient: pid });
      await M('Patient').deleteOne({ _id: pid });
    }
    await M('CaregiverAccess').deleteMany({ user: user._id });
    await M('Vital').deleteMany({ patientId: user._id }).catch(() => {});
    await User.deleteOne({ _id: user._id });
    console.log(`Deleted. ${phone} can be registered again.`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
