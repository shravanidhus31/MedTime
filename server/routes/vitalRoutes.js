const express = require('express');
const router = express.Router();
const Vital = require('../models/Vital');
const Patient = require('../models/Patient');
const { sendCaregiverSMS } = require('../utils/twilioClient');
const { verifyToken } = require('../middleware/authMiddleware');

// POST - Log new vitals and auto-calculate status
router.post('/', verifyToken, async (req, res) => {
  try {
    const { sys, dia, sugar, pulse, patientName } = req.body;
    const userId = req.user.id; // The logged-in patient's User._id

    let healthStatus = 'Normal';
    let needsAlert = false;

    if (sys >= 180 || dia >= 120) {
      healthStatus = 'Critical';
      needsAlert = true;
    } else if (sys >= 140 || dia >= 90) {
      healthStatus = 'High';
      needsAlert = true;
    } else if (sys >= 120 || dia >= 80) {
      healthStatus = 'Elevated';
      needsAlert = true;
    }

    const newVital = new Vital({
      patientId: userId, sys, dia, sugar, pulse, status: healthStatus
    });
    await newVital.save();

    // 🚨 EMERGENCY SMS ENGINE — mirrors missedDoseCron.js caregiver lookup
    if (needsAlert) {
      // Find the Patient profile for this user and populate all linked caregiver users
      const patientDoc = await Patient.findOne({ user: userId }).populate('caregivers.user');

      if (patientDoc && patientDoc.caregivers.length > 0) {
        const alertMsg = `🚨 MEDTIME ALERT: ${patientName || 'Your patient'} logged an ${healthStatus.toUpperCase()} Blood Pressure reading of ${sys}/${dia} mmHg. Please check on them immediately.`;

        // Blast SMS to every linked caregiver (same pattern as missed-dose cron)
        for (const caregiver of patientDoc.caregivers) {
          if (caregiver.user && caregiver.user.phone) {
            const formattedPhone = caregiver.user.phone.startsWith('+')
              ? caregiver.user.phone
              : `+91${caregiver.user.phone}`;
            console.log(`🚨 Sending BP Alert to Caregiver (${caregiver.user.name}) at ${formattedPhone}`);
            await sendCaregiverSMS(formattedPhone, alertMsg);
          }
        }
      } else {
        console.log("⚠️ No linked caregivers found for this patient — skipping BP alert.");
      }
    }

    res.status(201).json({ message: 'Vitals logged', vital: newVital });
  } catch (error) {
    console.error("Vitals Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET - Fetch all vitals for the logged-in patient
router.get('/', verifyToken, async (req, res) => {
  try {
    const vitals = await Vital.find({ patientId: req.user.id }).sort({ recordedAt: -1 });
    res.status(200).json(vitals);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;