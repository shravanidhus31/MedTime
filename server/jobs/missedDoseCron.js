const cron = require('node-cron');
const Reminder = require('../models/Reminder');
const Patient = require('../models/Patient');
const { sendCaregiverSMS } = require('../utils/twilioClient');

// Run this check every single minute
cron.schedule('* * * * *', async () => {
  try {
    // PRD says 15 minutes, but let's use 2 minutes for testing!
    const TWO_MINUTES_AGO = new Date(Date.now() - 2 * 60 * 1000);

    // 1. Find reminders that were alerted > 2 mins ago but NEVER confirmed
    const expiredReminders = await Reminder.find({
      status: 'alerted',
      alertedAt: { $lte: TWO_MINUTES_AGO },
      caregiverNotified: { $ne: true } // Don't spam them if we already alerted them
    }).populate('medicine patient');

    if (expiredReminders.length > 0) {
      console.log(`🚨 [CRON] Found ${expiredReminders.length} missed doses. Escalating...`);
    }

    // 2. Loop through each missed dose and escalate
    for (const reminder of expiredReminders) {
      // Mark it as missed in the database
      reminder.status = 'missed';
      reminder.caregiverNotified = true;
      reminder.caregiverNotifiedAt = new Date();
      await reminder.save();

      // Find the patient's caregivers so we know who to text
      const patientDoc = await Patient.findById(reminder.patient._id).populate('caregivers.user user');
      
      const timeStr = new Date(reminder.scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const patientName = patientDoc.user.name;
      const medName = reminder.medicine.name;

      const alertMessage = `⚠️ MedTime Alert: ${patientName} missed their ${medName} dose scheduled for ${timeStr}. Please check on them.`;

      // 3. Blast the SMS to every linked caregiver
      for (const caregiver of patientDoc.caregivers) {
        if (caregiver.user && caregiver.user.phone) {
          await sendCaregiverSMS(caregiver.user.phone, alertMessage);
        }
      }
    }
  } catch (error) {
    console.error('❌ Missed Dose Cron Error:', error);
  }
});