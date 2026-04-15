const cron = require('node-cron');
const Reminder = require('../models/Reminder');
const { sendSMS, makeCall } = require('../utils/twilioClient');

const startReminderJob = () => {
  // Running every 10 seconds for easy testing
  cron.schedule('*/10 * * * * *', async () => {
    console.log('⏳ [Cron Job] Checking for pending medications...');
    
    try {
      const now = new Date();
      
      // 1. NESTED POPULATE: Pull Patient, User, and Medicine details
      const pendingReminders = await Reminder.find({
        status: 'pending',
        scheduledTime: { $lte: now }
      })
      .populate({
        path: 'patient',
        populate: {
          path: 'user', 
          model: 'User'
        }
      })
      .populate('medicine');

      if (pendingReminders.length === 0) {
        return; 
      }

      console.log(`Found ${pendingReminders.length} reminders to process.`);

      for (const reminder of pendingReminders) {
        // 2. Extract Data
        const patientPhone = reminder.patient.user.phone; 
        const medName = reminder.medicine.name;
        const medDosage = reminder.medicine.dosage;
        const mealTiming = reminder.medicine.mealTiming;
        
        // Grab the preferred alert method (fallback to 'sms' if missing)
        const alertType = reminder.medicine.notificationType || 'sms'; 

        console.log(`Alerting patient via ${alertType.toUpperCase()} for ${medName}`);

        // 3. Route the notification based on preference
        try {
          if (alertType === 'call') {
            // NOTE: If testing on Twilio Free Trial, replace 'patientPhone' with your verified number
            await makeCall(patientPhone, medName, medDosage, mealTiming);
          } else {
            const message = `Hello from MedTime! It's time to take your ${medName} (${medDosage}). Instruction: ${mealTiming} food. Reply '1' when taken, or '2' to skip.`;
            // NOTE: If testing on Twilio Free Trial, replace 'patientPhone' with your verified number
            await sendSMS(patientPhone, message); 
          }
        } catch (alertError) {
          console.error(`❌ Failed to send ${alertType} notification:`, alertError);
        }

        // 4. Update the database to show we alerted them
        reminder.status = 'alerted';
        reminder.alertedAt = new Date();
        await reminder.save();
      }

    } catch (error) {
      console.error('❌ Error in reminder cron job:', error);
    }
  });
};

module.exports = { startReminderJob };