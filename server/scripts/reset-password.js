// Resets one account's password (the app has no "forgot password" flow yet).
// Run it yourself, in your own terminal, so the new password never leaves your machine:
//
//   cd server
//   node scripts/reset-password.js 8169003080
//
// It uses MONGO_URI from server/.env (your dev database). To reset an account on the live app,
// set MONGO_URI to the live database for that one command (from Render → Environment), e.g. in
// PowerShell:   $env:MONGO_URI = '<live MONGO_URI>'; node scripts/reset-password.js 8169003080
// then close that terminal. Never paste the URI or the password into a chat.
//
// It shows the account's name and role, asks you to confirm, then asks for the new password twice
// (hidden as you type). The old login session is signed out.

require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const phone = String(process.argv[2] || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
if (!/^\d{10}$/.test(phone)) {
  console.error('Usage: node scripts/reset-password.js <10-digit phone number>');
  process.exit(1);
}

// Reads one line without showing it (falls back to a visible prompt if this isn't a terminal).
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!hidden || !stdin.isTTY) {
      stdin.resume();
      stdin.once('data', (d) => { stdin.pause(); resolve(String(d).trim()); });
      return;
    }
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        process.stdout.write('\n'); process.exit(1);
      } else if (ch === '\u007f' || ch === '\b') {
        if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        value += ch; process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  const dbName = (() => { try { return new URL(process.env.MONGO_URI).pathname.replace(/^\//, '') || '(default)'; } catch { return '(none)'; } })();
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const user = await User.findOne({ phone: { $in: [phone, `+91${phone}`, `91${phone}`] } });
  if (!user) {
    console.error(`No account with phone ${phone} in database "${dbName}". (Is MONGO_URI the database the app uses?)`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`Database "${dbName}": found ${user.name} (${user.role}), phone ${user.phone}.`);
  const ok = (await ask('Reset this password? Type yes: ')).toLowerCase();
  if (ok !== 'yes') { console.log('Nothing changed.'); await mongoose.disconnect(); process.exit(0); }
  const pw = await ask('New password (at least 6 characters): ', { hidden: true });
  const again = await ask('Type it again: ', { hidden: true });
  if (pw.length < 6 || pw !== again) {
    console.error(pw !== again ? 'The two passwords differ. Nothing changed.' : 'Too short. Nothing changed.');
    await mongoose.disconnect();
    process.exit(1);
  }
  user.passwordHash = await bcrypt.hash(pw, 10);
  user.refreshToken = null; // signs out the old session
  await user.save();
  console.log('Password changed. Log in with the new password.');
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => {
  console.error('Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
