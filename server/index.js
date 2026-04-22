require('dotenv').config();
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
const { startReminderJob } = require('./jobs/reminderJob');
const { startMonthlyReportCron } = require('./utils/monthlyReportCron');
require('./jobs/missedDoseCron');
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
// Database Connection & Server Start
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ Successfully connected to MongoDB Atlas');
    startReminderJob();
    startMonthlyReportCron();
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('❌ Error connecting to MongoDB:', error.message);
    process.exit(1); // Exit process with failure
  });