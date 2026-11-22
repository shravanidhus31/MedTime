const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken } = require('../middleware/authMiddleware');
const { encrypt, decrypt } = require('../utils/encryptionUtil');

/**
 * PUT /api/v1/users/doctor-settings
 * Protected — patient must supply a valid JWT.
 * Body: { name, email, autoSendMonthly }
 * Updates the logged-in patient's linkedDoctor sub-document.
 */
router.put('/doctor-settings', verifyToken, async (req, res) => {
  try {
    const { name, email, autoSendMonthly } = req.body;
    const userId = req.user.id;

    // Basic validation — email is required when automation is on
    if (autoSendMonthly && !email) {
      return res.status(400).json({
        message: 'A doctor email address is required to enable automated monthly reports.'
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          'linkedDoctor.name': name || '',
          'linkedDoctor.email': email ? encrypt(email.trim().toLowerCase()) : '',
          'linkedDoctor.autoSendMonthly': Boolean(autoSendMonthly)
        }
      },
      { returnDocument: 'after', runValidators: true, select: '-passwordHash -refreshToken' }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // Return decrypted email to the frontend
    const safeDoctor = {
      ...updatedUser.linkedDoctor.toObject(),
      email: decrypt(updatedUser.linkedDoctor.email)
    };

    res.status(200).json({
      message: 'Doctor settings saved successfully.',
      linkedDoctor: safeDoctor
    });
  } catch (error) {
    console.error('❌ Error saving doctor settings:', error);
    res.status(500).json({ message: 'Internal server error.', error: error.message });
  }
});

/**
 * GET /api/v1/users/doctor-settings
 * Protected — returns the logged-in patient's current linked-doctor data.
 */
router.get('/doctor-settings', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('linkedDoctor');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    // Decrypt the stored email before returning it to the client
    const linkedDoctor = user.linkedDoctor
      ? { ...user.linkedDoctor.toObject(), email: decrypt(user.linkedDoctor.email) }
      : {};

    res.status(200).json({ linkedDoctor });
  } catch (error) {
    console.error('❌ Error fetching doctor settings:', error);
    res.status(500).json({ message: 'Internal server error.', error: error.message });
  }
});

// ─── Call settings (A3.5) ─────────────────────────────────────────────────────
// GET /api/v1/users/care-settings[?patientId=]   → { patientId, dementiaMode, language, emergencyContact }
// PUT /api/v1/users/care-settings  { patientId?, dementiaMode?, language?, emergencyContact? }
// dementiaMode on: dose calls run the speech agent (retries, check question, caregiver hand-over);
// off: the keypad menu. language: what the agent speaks and listens for (en, hi; mr not written yet).
// The patient changes their own; a caregiver needs primary access to that patient.
const mongoose = require('mongoose');
const Patient = require('../models/Patient');
const { canAccess } = require('../middleware/access');

async function carePatient(req) {
  const patientId = req.query.patientId || (req.body && req.body.patientId);
  if (patientId) {
    if (!mongoose.isValidObjectId(patientId)) return { status: 400, message: 'Not a valid patient id' };
    if (!(await canAccess(req.user.id, patientId, 'primary'))) return { status: 403, message: 'Forbidden: only the patient or their primary caregiver can change call settings.' };
    const p = await Patient.findById(patientId);
    return p ? { patient: p } : { status: 404, message: 'Patient not found' };
  }
  const p = await Patient.findOne({ user: req.user.id });
  return p ? { patient: p } : { status: 404, message: 'No patient profile for this account.' };
}
const careView = (p) => ({ patientId: String(p._id), dementiaMode: !!p.dementiaMode, language: p.language || 'en', emergencyContact: p.emergencyContact || '' });

router.get('/care-settings', verifyToken, async (req, res) => {
  try {
    const r = await carePatient(req);
    if (!r.patient) return res.status(r.status).json({ message: r.message });
    res.json(careView(r.patient));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.put('/care-settings', verifyToken, async (req, res) => {
  try {
    const r = await carePatient(req);
    if (!r.patient) return res.status(r.status).json({ message: r.message });
    const { dementiaMode, language, emergencyContact } = req.body || {};
    const set = {};
    // Called for red flags and missed doses when no caregiver is linked (services/caregiverAlerts.js).
    if (emergencyContact !== undefined) {
      const digits = String(emergencyContact).replace(/[\s-]/g, '');
      if (!/^(\+91)?[6-9]\d{9}$/.test(digits)) return res.status(400).json({ message: 'Emergency contact must be a 10-digit Indian mobile number (optionally with +91).' });
      set.emergencyContact = digits;
    }
    if (dementiaMode !== undefined) set.dementiaMode = !!dementiaMode;
    if (language !== undefined) {
      if (!['en', 'hi', 'mr'].includes(language)) return res.status(400).json({ message: 'language must be en, hi or mr' });
      set.language = language;
    }
    // only these two fields (older patient records may not pass full validation on save)
    const updated = await Patient.findByIdAndUpdate(r.patient._id, { $set: set }, { returnDocument: 'after' });
    res.json(careView(updated));
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
