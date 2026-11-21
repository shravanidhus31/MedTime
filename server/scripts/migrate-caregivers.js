/**
 * migrate-caregivers.js — B1.1 migration
 *
 * One-time script.  Run ONCE after the CaregiverAccess model is live:
 *   cd server && node scripts/migrate-caregivers.js
 *
 * What it does:
 *   - Reads every Patient document that has entries in the old `caregivers` array
 *     (the embedded sub-documents from the original Patient schema).
 *   - Creates a CaregiverAccess record for each one:
 *       - The first caregiver in the array becomes 'primary' (active).
 *       - Any subsequent caregivers become 'approve' (active).
 *   - Does NOT remove the old `caregivers` array — that is Person A's concern
 *     when they refactor dose routes.  The new access middleware only reads
 *     CaregiverAccess, so both can coexist during the transition.
 *
 * Safe to re-run: uses updateOne with upsert to avoid duplicates.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose       = require('mongoose');
const Patient        = require('../models/Patient');
const CaregiverAccess = require('../models/CaregiverAccess');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB.');

  const patients = await Patient.find({
    'caregivers.0': { $exists: true },
  }).lean();

  console.log(`Found ${patients.length} patient(s) with existing caregiver links.`);

  let created = 0;
  let skipped = 0;

  for (const patient of patients) {
    for (let i = 0; i < patient.caregivers.length; i++) {
      const cg   = patient.caregivers[i];
      const role = i === 0 ? 'primary' : 'approve';

      try {
        const result = await CaregiverAccess.updateOne(
          { patient: patient._id, user: cg.user },
          {
            $setOnInsert: {
              patient:    patient._id,
              user:       cg.user,
              role,
              status:     'active',
              approvedAt: new Date(),
              invitedBy:  cg.user, // self-linked in the old system
            },
          },
          { upsert: true }
        );

        if (result.upsertedCount > 0) {
          console.log(`  ✅ Created ${role} access for user ${cg.user} → patient ${patient._id}`);
          created++;
        } else {
          console.log(`  ⏭  Already exists: user ${cg.user} → patient ${patient._id}`);
          skipped++;
        }
      } catch (err) {
        console.error(`  ❌ Failed for user ${cg.user}: ${err.message}`);
      }
    }
  }

  console.log(`\nDone. Created: ${created}, Skipped (already existed): ${skipped}.`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
