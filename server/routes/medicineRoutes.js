const express = require('express');
const Medicine = require('../models/Medicine');
const Reminder = require('../models/Reminder');
const Patient = require('../models/Patient');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

// POST /api/v1/medicines - Add a new medicine and auto-generate reminders
router.post('/', verifyToken, requireRole(['patient', 'caregiver']), async (req, res) => {
  try {
    const { name, dosage, type, frequency, scheduledTimes, mealTiming, startDate, tabletCount,notificationType} = req.body;
    const userId = req.user.id;

    // 1. Ensure the Patient profile exists (auto-create if missing for this user)
    let patient = await Patient.findOne({ user: userId });
    if (!patient) {
      patient = new Patient({ user: userId, emergencyContact: req.body.emergencyContact || '0000000000' });
      await patient.save();
    }

    // 2. Create the Medicine Document
    const newMedicine = new Medicine({
      patient: patient._id,
      name,
      dosage,
      type,
      frequency,
      scheduledTimes, // e.g., ["08:00", "20:00"]
      mealTiming,
      startDate: new Date(startDate),
      tabletCount,notificationType: notificationType || 'sms'

    });

    await newMedicine.save();

    // 3. Auto-Generate Reminders for the next 7 days (to save DB space on free tier)
    const remindersToCreate = [];
    const today = new Date();

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() + dayOffset);

      // Create a reminder for each scheduled time on this day
      for (const timeStr of scheduledTimes) {
        const [hours, minutes] = timeStr.split(':');
        const reminderTime = new Date(currentDate);
        reminderTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

        // Only create reminders for future times
        if (reminderTime > new Date()) {
          remindersToCreate.push({
            medicine: newMedicine._id,
            patient: patient._id,
            scheduledTime: reminderTime,
            status: 'pending'
          });
        }
      }
    }

    // Bulk insert reminders for efficiency
    if (remindersToCreate.length > 0) {
      await Reminder.insertMany(remindersToCreate);
    }

    res.status(201).json({ 
      message: 'Medicine added and reminders generated successfully.',
      medicine: newMedicine,
      remindersGenerated: remindersToCreate.length
    });

  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /api/v1/medicines - Get all medicines for the logged-in patient
router.get('/', verifyToken, async (req, res) => {
  try {
    const patient = await Patient.findOne({ user: req.user.id });
    if (!patient) return res.status(200).json([]); // No profile yet, return empty array

    const medicines = await Medicine.find({ patient: patient._id, isActive: true });
    res.status(200).json(medicines);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;