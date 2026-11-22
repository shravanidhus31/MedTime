/**
 * MedTime Seed Script — B7
 *
 * Populates MongoDB with realistic test and demo data:
 * - Patients with dementia mode and agent flags
 * - Primary and doctor caregivers with active CaregiverAccess roles
 * - Active medicines with complete C10 step-by-step guidance fields
 * - 30 days of realistic Reminder dose history + next 7 days of pending reminders
 * - Life notes for memory and call-in continuity
 * - Agent runs with timeline steps ('Patient said', 'Agent noticed', 'Action taken')
 * - Pending proposals and agent questions for approval gate testing
 *
 * Usage:
 *   cd server && node scripts/seed.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const User = require('../models/User');
const Patient = require('../models/Patient');
const CaregiverAccess = require('../models/CaregiverAccess');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const LifeNote = require('../models/LifeNote');
const AgentRun = require('../models/AgentRun');
const ProposedChange = require('../models/ProposedChange');
const AgentQuestion = require('../models/AgentQuestion');

async function seed() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌ MONGO_URI is missing from server/.env. Please configure it first.');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected.');

  console.log('Cleaning up existing demo test records for seed phone numbers...');
  const testPhones = ['9000000001', '9000000002', '9000000003'];
  const existingUsers = await User.find({ phone: { $in: testPhones } });
  const userIds = existingUsers.map((u) => u._id);

  if (userIds.length > 0) {
    const existingPatients = await Patient.find({ user: { $in: userIds } });
    const patientIds = existingPatients.map((p) => p._id);

    await Reminder.deleteMany({ patient: { $in: patientIds } });
    await Medicine.deleteMany({ patient: { $in: patientIds } });
    await CaregiverAccess.deleteMany({ $or: [{ patient: { $in: patientIds } }, { user: { $in: userIds } }] });
    await LifeNote.deleteMany({ patient: { $in: patientIds } });
    await AgentRun.deleteMany({ patient: { $in: patientIds } });
    await ProposedChange.deleteMany({ patient: { $in: patientIds } });
    await AgentQuestion.deleteMany({ patient: { $in: patientIds } });
    await Patient.deleteMany({ _id: { $in: patientIds } });
    await User.deleteMany({ _id: { $in: userIds } });
    console.log('Existing test data cleaned up.');
  }

  // ─── 1. Create Users ────────────────────────────────────────────────────────
  console.log('Creating users...');
  const passwordHash = await bcrypt.hash('test1234', 10);

  const patientUser = await User.create({
    name: 'Saraswati Ramachandran',
    phone: '9000000001',
    passwordHash,
    role: 'patient',
  });

  const primaryCaregiverUser = await User.create({
    name: 'Priya Ramachandran',
    phone: '9000000002',
    passwordHash,
    role: 'caregiver',
  });

  const doctorCaregiverUser = await User.create({
    name: 'Dr. Ramesh Iyer',
    phone: '9000000003',
    passwordHash,
    role: 'caregiver',
  });

  // ─── 2. Create Patient Profile ──────────────────────────────────────────────
  console.log('Creating patient profile...');
  const patient = await Patient.create({
    user: patientUser._id,
    age: 76,
    bloodGroup: 'B+',
    emergencyContact: '9000000002', // Priya's phone
    conditions: ['Mild Cognitive Impairment', 'Hypertension', 'Osteoarthritis'],
    dementiaMode: true,
    elderlyMode: true,
    language: 'en',
    familyClipsEnabled: true,
    preferredChannel: 'voice',
  });

  // ─── 3. Create Caregiver Access Records (Contract C3) ──────────────────────
  console.log('Linking caregivers with tiered roles...');
  await CaregiverAccess.create([
    {
      patient: patient._id,
      user: primaryCaregiverUser._id,
      role: 'primary',
      status: 'active',
      approvedAt: new Date(),
      invitedBy: patientUser._id,
    },
    {
      patient: patient._id,
      user: doctorCaregiverUser._id,
      role: 'doctor',
      status: 'active',
      approvedAt: new Date(),
      invitedBy: primaryCaregiverUser._id,
    },
  ]);

  // ─── 4. Create Active Medicines with C10 Guidance Fields ───────────────────
  console.log('Creating medicines with step-by-step guidance fields...');
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const donepezil = await Medicine.create({
    patient: patient._id,
    name: 'Donepezil',
    dosage: '5mg',
    type: 'tablet',
    frequency: 'once',
    scheduledTimes: ['08:00'],
    mealTiming: 'after',
    startDate: thirtyDaysAgo,
    tabletCount: 28,
    refillThreshold: 5,
    notificationType: 'call',
    isActive: true,
    // C10 fields
    pillDescription: 'Small round white film-coated tablet with 5 debossed',
    pillboxSlot: 'Morning / Compartment 1',
    locationHint: 'Kitchen table beside the electric kettle',
  });

  const memantine = await Medicine.create({
    patient: patient._id,
    name: 'Memantine',
    dosage: '10mg',
    type: 'tablet',
    frequency: 'twice',
    scheduledTimes: ['08:00', '20:00'],
    mealTiming: 'with',
    startDate: thirtyDaysAgo,
    tabletCount: 54,
    refillThreshold: 10,
    notificationType: 'call',
    isActive: true,
    // C10 fields
    pillDescription: 'White capsule-shaped biconvex tablet',
    pillboxSlot: 'Morning and Evening slots',
    locationHint: 'Kitchen medicine box',
  });

  const amlodipine = await Medicine.create({
    patient: patient._id,
    name: 'Amlodipine',
    dosage: '5mg',
    type: 'tablet',
    frequency: 'once',
    scheduledTimes: ['09:00'],
    mealTiming: 'any',
    startDate: thirtyDaysAgo,
    tabletCount: 16,
    refillThreshold: 5,
    notificationType: 'sms',
    isActive: true,
    // C10 fields
    pillDescription: 'White flat-faced octagonal tablet',
    pillboxSlot: 'Morning / Slot 2',
    locationHint: 'Dining room counter',
  });

  const medicines = [donepezil, memantine, amlodipine];

  // ─── 5. Create 30 Days of Past Reminders & Next 7 Days Pending ─────────────
  console.log('Generating 30-day dose history and upcoming reminders...');
  const remindersToCreate = [];

  for (let dayOffset = -30; dayOffset <= 7; dayOffset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + dayOffset);

    for (const med of medicines) {
      for (const timeStr of med.scheduledTimes) {
        const [hours, minutes] = timeStr.split(':').map(Number);
        const reminderTime = new Date(day);
        // Render runs UTC; IST is UTC + 5h30m -> subtract 5h30m
        reminderTime.setUTCHours(hours - 5, minutes - 30, 0, 0);

        if (dayOffset < 0) {
          // Past history (90% taken, 6% skipped, 4% missed)
          const rand = Math.random();
          let status = 'taken';
          let confirmedBy = 'ivr';
          if (rand < 0.05) {
            status = 'missed';
            confirmedBy = undefined;
          } else if (rand < 0.1) {
            status = 'skipped';
            confirmedBy = 'app';
          }

          remindersToCreate.push({
            medicine: med._id,
            patient: patient._id,
            scheduledTime: reminderTime,
            status,
            confirmedAt: status === 'taken' ? new Date(reminderTime.getTime() + 12 * 60000) : null,
            confirmedBy,
          });
        } else if (dayOffset === 0 && reminderTime < now) {
          // Today's earlier dose
          remindersToCreate.push({
            medicine: med._id,
            patient: patient._id,
            scheduledTime: reminderTime,
            status: 'taken',
            confirmedAt: new Date(reminderTime.getTime() + 8 * 60000),
            confirmedBy: 'ivr',
          });
        } else {
          // Future pending doses
          remindersToCreate.push({
            medicine: med._id,
            patient: patient._id,
            scheduledTime: reminderTime,
            status: 'pending',
          });
        }
      }
    }
  }

  await Reminder.insertMany(remindersToCreate);
  console.log(`Created ${remindersToCreate.length} reminder records.`);

  // ─── 6. Create Life Notes (B9 Memory Graph) ────────────────────────────────
  console.log('Creating memory graph life notes...');
  await LifeNote.create([
    {
      patient: patient._id,
      writtenBy: primaryCaregiverUser._id,
      kind: 'person',
      title: 'Priya (Daughter)',
      text: 'Priya lives 15 minutes away in Indiranagar. She visits every Tuesday and Saturday evening and manages medicines.',
      approved: true,
    },
    {
      patient: patient._id,
      writtenBy: primaryCaregiverUser._id,
      kind: 'routine',
      title: 'Morning Ginger Chai',
      text: 'Enjoys ginger chai at 7:30 AM with two Marie biscuits before taking her morning Donepezil and Memantine.',
      approved: true,
    },
    {
      patient: patient._id,
      writtenBy: primaryCaregiverUser._id,
      kind: 'topic_answer',
      title: 'Where is Raghav? (Deceased Husband)',
      text: 'Raghav is in our prayers and hearts. He is resting peacefully. We remember his gentle smile every day.',
      approved: true,
    },
  ]);

  // ─── 7. Create Agent Runs for Activity Panel (Contract C2, B6) ─────────────
  console.log('Creating simulated agent runs...');
  await AgentRun.create([
    {
      trigger: 'dose',
      patient: patient._id,
      reminder: remindersToCreate[0]?._id,
      flow: 'dose',
      status: 'completed',
      model: 'groq/gpt-oss-20b',
      outcome: 'Donepezil 5mg confirmed taken via check question in 3 turns',
      steps: [
        {
          tool: 'get_patient_context',
          label: 'agent_noticed',
          summaryText: 'Loaded routine context: Donepezil due at 08:00 AM after food',
          ms: 45,
          at: new Date(now.getTime() - 25 * 60000),
        },
        {
          tool: 'check_double_dose',
          label: 'agent_noticed',
          summaryText: 'Verified no duplicate doses recorded for today',
          ms: 22,
          at: new Date(now.getTime() - 24 * 60000),
        },
        {
          tool: 'listen',
          label: 'patient_said',
          summaryText: '"Amma, I see the small white round pill on the kitchen table."',
          ms: 1200,
          at: new Date(now.getTime() - 22 * 60000),
        },
        {
          tool: 'mark_dose',
          label: 'action_taken',
          summaryText: 'Confirmed check question and logged Donepezil dose as taken',
          ms: 60,
          at: new Date(now.getTime() - 20 * 60000),
        },
      ],
    },
  ]);

  // ─── 8. Create Sample Proposal & Question (B4) ─────────────────────────────
  console.log('Creating sample pending proposal and question...');
  await ProposedChange.create({
    patient: patient._id,
    kind: 'new_schedule',
    level: 1,
    status: 'pending',
    evidence: 'Prescription OCR scan detected Pantoprazole 40mg once daily before breakfast.',
    payload: {
      name: 'Pantoprazole',
      dosage: '40mg',
      type: 'tablet',
      frequency: 'once',
      scheduledTimes: ['07:30'],
      mealTiming: 'before',
      pillDescription: 'Yellow oval enteric-coated tablet',
      pillboxSlot: 'Morning Slot 0',
      locationHint: 'Kitchen counter',
    },
  });

  await AgentQuestion.create({
    patient: patient._id,
    question: 'Should Saraswati take her evening Memantine dose at 7:30 PM before dinner or at 8:30 PM after dinner?',
    choices: ['7:30 PM (Before dinner)', '8:30 PM (After dinner)'],
    status: 'pending',
  });

  console.log('\n======================================================');
  console.log('✅ Seed complete! You can now log in with:');
  console.log('   - Patient:   Phone: 9000000001 | Password: test1234');
  console.log('   - Caregiver: Phone: 9000000002 | Password: test1234');
  console.log('   - Doctor:    Phone: 9000000003 | Password: test1234');
  console.log('======================================================\n');

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed script failed:', err);
  process.exit(1);
});
