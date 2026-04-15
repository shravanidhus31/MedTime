const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const User = require('../models/User');
const Patient = require('../models/Patient');
const Reminder = require('../models/Reminder');

const MessagingResponse = twilio.twiml.MessagingResponse;

// POST /api/v1/webhooks/sms
router.post('/sms', async (req, res) => {
  const incomingMsg = req.body.Body.trim().toLowerCase(); // e.g., '1' or '2'
  let fromNumber = req.body.From; // e.g., '+919876543210'

  // Clean the number format if necessary to match your DB (e.g., removing the +91)
  if (fromNumber.startsWith('+91')) {
    fromNumber = fromNumber.replace('+91', '');
  }

  const twiml = new MessagingResponse();

  try {
    // 1. Find the User by phone number
    const user = await User.findOne({ phone: fromNumber });
    if (!user) {
      twiml.message("Sorry, we couldn't find a MedTime account linked to this number.");
      return res.type('text/xml').send(twiml.toString());
    }

    // 2. Find the Patient profile
    const patient = await Patient.findOne({ user: user._id });

    // 3. Find their most recent 'alerted' reminder
    const recentReminder = await Reminder.findOne({ 
      patient: patient._id, 
      status: 'alerted' 
    }).sort({ scheduledTime: -1 }); // Get the most recent one

    if (!recentReminder) {
      twiml.message("You have no pending medications right now. Great job!");
      return res.type('text/xml').send(twiml.toString());
    }

    // 4. Update the DB based on their reply
    if (incomingMsg === '1') {
      recentReminder.status = 'taken';
      await recentReminder.save();
      twiml.message(`✅ Confirmed! We've recorded that you took your medicine. Have a great day!`);
    
    } else if (incomingMsg === '2') {
      recentReminder.status = 'skipped';
      await recentReminder.save();
      twiml.message(`⚠️ Noted. We've recorded this dose as skipped. We will update your caregiver.`);
    
    } else {
      twiml.message("Please reply with '1' if you took your medicine, or '2' if you skipped it.");
    }

    // Send the response back to Twilio
    res.type('text/xml').send(twiml.toString());

  } catch (error) {
    console.error('Webhook error:', error);
    twiml.message("We experienced an error processing your reply.");
    res.type('text/xml').send(twiml.toString());
  }
});
// POST /api/v1/webhooks/voice
router.post('/voice', async (req, res) => {
  const digits = req.body.Digits; // Will be '1' or '2'
  let calledNumber = req.body.To; // Twilio sends the patient's number as 'To' for outbound calls

  console.log(`📞 [VOICE WEBHOOK] Patient pressed: ${digits}`);

  // Clean the +91 to match your database
  if (calledNumber.startsWith('+91')) {
    calledNumber = calledNumber.replace('+91', '');
  }

  try {
    const user = await User.findOne({ phone: calledNumber });
    if (user) {
      const patient = await Patient.findOne({ user: user._id });
      
      // Find the most recent alerted reminder
      const recentReminder = await Reminder.findOne({ 
        patient: patient._id, 
        status: 'alerted' 
      }).sort({ scheduledTime: -1 });

      if (recentReminder) {
        if (digits === '1') {
          recentReminder.status = 'taken';
          await recentReminder.save();
          console.log('✅ Database updated: Medicine TAKEN');
        } else if (digits === '2') {
          recentReminder.status = 'skipped';
          await recentReminder.save();
          console.log('⚠️ Database updated: Medicine SKIPPED');
        }
      }
    }

    // Tell the robot what to say before hanging up
    const twimlResponse = `
      <Response>
        <Say voice="alice">Thank you, your medical records have been updated. Goodbye!</Say>
      </Response>
    `;
    
    res.type('text/xml').send(twimlResponse);

  } catch (error) {
    console.error('Voice Webhook Error:', error);
    res.type('text/xml').send('<Response><Say>Sorry, an error occurred. Goodbye.</Say></Response>');
  }
});

module.exports = router;