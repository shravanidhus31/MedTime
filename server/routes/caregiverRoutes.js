const express = require('express');
const { verifyToken } = require('../middleware/authMiddleware');
const Patient = require('../models/Patient');
const User = require('../models/User');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');

const router = express.Router();

// 1. GET /api/v1/caregiver/dashboard - STRICTLY get assigned patients
router.get('/dashboard', verifyToken, async (req, res) => {
  try {
    // STRICT FILTER: Only find patients where this specific caregiver's ID is in their array
    const patients = await Patient.find({ 
      'caregivers.user': req.user.id 
    }).populate('user', 'name phone').lean();

    const now = new Date();

    const dashboardData = await Promise.all(patients.map(async (patient) => {
      const medicines = await Medicine.find({ patient: patient._id, isActive: true }).lean();
      
      let skippedCount = 0;
      let missedCount = 0;
      let actionRequired = [];

      for (const med of medicines) {
        const currentReminder = await Reminder.findOne({
          medicine: med._id,
          scheduledTime: { $lte: now }
        }).sort({ scheduledTime: -1 });

        if (currentReminder) {
          if (currentReminder.status === 'skipped') {
            skippedCount++;
            actionRequired.push({ ...med, alert: 'Skipped intentionally' });
          } else if (currentReminder.status === 'alerted' || currentReminder.status === 'due') {
            missedCount++;
            actionRequired.push({ ...med, alert: 'No response from patient' });
          }
        }
      }

      let healthStatus = 'good';
      if (skippedCount > 0 || missedCount > 0) healthStatus = 'critical';

      return {
        patientId: patient._id,
        name: patient.user.name,
        phone: patient.user.phone,
        healthStatus,
        activePrescriptions: medicines.length,
        actionRequired 
      };
    }));

    res.status(200).json(dashboardData);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// 2. POST /api/v1/caregiver/link - Link a caregiver to a patient via the patient's phone number
router.post('/link', verifyToken, async (req, res) => {
  try {
    const { patientPhone } = req.body;

    // Find the user holding this phone number
    const targetUser = await User.findOne({ phone: patientPhone });
    if (!targetUser) return res.status(404).json({ message: 'No account found with that phone number.' });

    // Find their patient profile
    const patientProfile = await Patient.findOne({ user: targetUser._id });
    if (!patientProfile) return res.status(404).json({ message: 'Patient profile not set up yet.' });

    // Check if already linked
    const alreadyLinked = patientProfile.caregivers.some(
      cg => cg.user.toString() === req.user.id.toString()
    );

    if (alreadyLinked) {
      return res.status(400).json({ message: 'You are already linked to this patient.' });
    }

    // Link them!
    patientProfile.caregivers.push({
      user: req.user.id,
      role: 'family',
      permissions: 'all'
    });

    await patientProfile.save();
    res.status(200).json({ message: `Successfully linked to ${targetUser.name}` });

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
// GET /api/v1/caregiver/patients/:patientId/history - Get 7-day reminder history
router.get('/patients/:patientId/history', verifyToken, async (req, res) => {
  try {
    const patient = await Patient.findOne({
      _id: req.params.patientId,
      'caregivers.user': req.user.id
    });

    if (!patient) return res.status(403).json({ message: 'Unauthorized' });

    // 1. Get midnight 7 days ago
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - 6);
    startOfWeek.setHours(0, 0, 0, 0);

    // 2. Get 11:59 PM TONIGHT (So we don't cut off pending pills)
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const history = await Reminder.find({
      patient: req.params.patientId,
      scheduledTime: { $gte: startOfWeek, $lte: endOfToday } // Catch the whole week!
    })
    .populate('medicine', 'name dosage mealTiming')
    .sort({ scheduledTime: -1 })
    .lean();

    res.status(200).json(history);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
module.exports = router;