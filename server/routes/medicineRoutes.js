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
        const [hours, minutes] = timeStr.split(':').map(Number);
        const reminderTime = new Date(currentDate);
        // Render server runs UTC. scheduledTimes are IST strings (e.g. "16:04").
        // Convert IST → UTC: subtract 5h30m via setUTCHours.
        // JS handles negatives: setUTCHours(11, -26) correctly becomes 10:34 UTC.
        reminderTime.setUTCHours(hours - 5, minutes - 30, 0, 0);

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
// GET /api/v1/medicines - Get all medicines for the logged-in patient
// GET /api/v1/medicines - Get medicines with EXACT current status
router.get('/', verifyToken, async (req, res) => {
  try {
    const patient = await Patient.findOne({ user: req.user.id });
    if (!patient) return res.status(200).json([]);

    const medicines = await Medicine.find({ patient: patient._id, isActive: true }).lean();
    const now = new Date();

    const medicinesWithStatus = await Promise.all(medicines.map(async (med) => {
      // Find the most recent reminder that has passed or is happening RIGHT NOW
      const currentReminder = await Reminder.findOne({
        medicine: med._id,
        scheduledTime: { $lte: now }
      }).sort({ scheduledTime: -1 });

      let displayStatus = 'upcoming'; // Default if it's scheduled for the future

      if (currentReminder) {
        if (currentReminder.status === 'taken') displayStatus = 'taken';
        else if (currentReminder.status === 'skipped') displayStatus = 'skipped';
        else displayStatus = 'due'; // It's in the past but hasn't been taken/skipped yet
      }

      return { ...med, status: displayStatus };
    }));

    res.status(200).json(medicinesWithStatus);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// DELETE /api/v1/medicines/:id - Cancel a medicine
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    // Delete the medicine
    await Medicine.findByIdAndDelete(req.params.id);
    // CRITICAL: Delete all future reminders for this medicine so the cron job doesn't crash!
    await Reminder.deleteMany({ medicine: req.params.id }); 
    
    res.status(200).json({ message: 'Medicine cancelled successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});
// POST /api/v1/medicines/:id/status - Manually Take or Skip from the Web UI
router.post('/:id/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body; // Expects 'taken' or 'skipped'
    
    // Find the most recent due reminder for this medicine
    const recentReminder = await Reminder.findOne({
      medicine: req.params.id,
      scheduledTime: { $lte: new Date() }
    }).sort({ scheduledTime: -1 });

    if (recentReminder) {
      recentReminder.status = status;
      await recentReminder.save();
      res.status(200).json({ message: `Medicine marked as ${status}` });
    } else {
      res.status(404).json({ message: 'No pending reminder found to update right now.' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// PUT /api/v1/medicines/:id - Edit an existing medicine
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const updatedMed = await Medicine.findByIdAndUpdate(
      req.params.id, 
      req.body, 
      { new: true }
    );
    
    // Note: In a production app, if they change the TIME, you would also need to 
    // delete future reminders and regenerate them here. For now, this updates the core info!
    res.status(200).json({ message: 'Medicine updated', medicine: updatedMed });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// DELETE /api/v1/medicines/:id - Cancel a medicine completely
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    await Medicine.findByIdAndDelete(req.params.id);
    await Reminder.deleteMany({ medicine: req.params.id }); 
    res.status(200).json({ message: 'Medicine cancelled successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;