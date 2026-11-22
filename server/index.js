require('dotenv').config();
// A1.2: refuse to start in production without PUBLIC_BASE_URL (Person A). Runs
// before anything else loads, because the cron jobs start as soon as they're required.
{
  const urlCheck = require('./utils/publicUrl').checkPublicBaseUrl();
  if (!urlCheck.ok) {
    console.error(`❌ [Startup] ${urlCheck.error}`);
    process.exit(1);
  }
  if (urlCheck.warning) console.warn(`⚠️  [Startup] ${urlCheck.warning}`);
  // The address to paste into the Twilio number's "A call comes in" webhook (call-in, A3.5). It
  // carries a token, so it works even when Twilio sends no signature header.
  const { twilioEnabled } = require('./utils/runtime');
  const base = require('./utils/publicUrl').publicBaseUrl();
  if (twilioEnabled() && base) {
    const { withToken } = require('./middleware/twilioSignature');
    console.log(`📞 [Startup] Call-in webhook for the Twilio number (POST): ${base}${withToken('/api/v1/voice/incoming', 'incoming')}`);
  }
}
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const webhookRoutes = require('./routes/webhookRoutes');
const ocrRoutes = require('./routes/ocrRoutes');
const userRoutes = require('./routes/userRoutes');
const dns = require('dns');
dns.setServers(["1.1.1.1", "8.8.8.8"]);


// Initialize Express app
const app = express();
const authRoutes = require('./routes/authRoutes');
const medicineRoutes = require('./routes/medicineRoutes');
const caregiverRoutes = require('./routes/caregiverRoutes');
const { startReminderJob }     = require('./jobs/reminderJob');
const { startMonthlyReportCron } = require('./utils/monthlyReportCron');
const { startReminderTopUpJob }  = require('./jobs/reminderTopUpJob');  // B1.4
const { startJournalJob }        = require('./jobs/journalJob');        // B8
require('./jobs/missedDoseCron');
require('./events'); // Contract C4 event bus & refill listeners
// Middleware
app.use(cors());
app.use(express.json()); // Parses incoming JSON requests
app.use(express.urlencoded({ extended: true }));

// Test Route
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({ status: 'success', message: 'MedTime API is running!' });
});
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/medicines', medicineRoutes);
app.use('/api/v1/webhooks', webhookRoutes);
app.use('/api/v1/caregiver', caregiverRoutes);
app.use('/api/v1/ocr', ocrRoutes);
app.use('/api/v1/vitals', require('./routes/vitalRoutes'));
app.use('/api/v1/reports', require('./routes/reportRoutes'));
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/agent/questions', require('./routes/agentQuestionRoutes')); // B4 caregiver questions (Person B)
app.use('/api/v1/agent', require('./routes/agentRoutes')); // A2.3 agent runs (C2) + A2.4 /agent/turn (Person A)
require('./agent').initAgent(); // A2.5 core tools + red-flag caregiver alerts; wires B's C3/C9 (Person A)
app.use('/api/v1/simulate', require('./routes/simulateRoutes')); // A2.7 text simulated calls (Person A)
app.use('/api/v1/doses', require('./routes/doseRoutes')); // A1.4 taken/skipped for one dose (Person A)
app.use('/api/v1/proposals', require('./routes/proposalRoutes')); // B4 approvals (Person B)
app.use('/api/v1/journal', require('./routes/journalRoutes')); // B8 daily care journal (Person B)
app.use('/api/v1/life-notes', require('./routes/lifeNoteRoutes')); // B9 life notes (Person B)
app.use('/api/v1/voice/agent', require('./routes/voiceAgentRoutes')); // A3.5 Twilio phone adapter (Person A)
app.use('/api/v1/voice', require('./routes/voiceIncoming')); // B11 call-in agent (Person B)
app.use('/api/v1/weekly-review', require('./routes/weeklyReviewRoutes')); // B14 weekly review (Person B)
app.use('/api/v1/copilot', require('./routes/copilotRoutes')); // B15 caregiver copilot (Person B)
// Database Connection & Server Start
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ Successfully connected to MongoDB Atlas');
    startReminderJob();
    startMonthlyReportCron();
    startReminderTopUpJob();   // B1.4: nightly reminder top-up
    // Also top up once at start, so a server that was asleep at midnight (Render free plan)
    // still has this week's reminders (integration).
    require('./jobs/reminderTopUpJob').topUpReminders()
      .then((r) => console.log(`✅ [reminderTopUp] Start-up top-up: ${r.created} reminder(s) created.`))
      .catch((err) => console.error('❌ [reminderTopUp] Start-up top-up failed:', err.message));
    startJournalJob();         // B8: nightly 9:00 PM IST daily care journal
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('❌ Error connecting to MongoDB:', error.message);
    process.exit(1); // Exit process with failure
  });