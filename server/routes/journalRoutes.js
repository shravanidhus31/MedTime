const express = require('express');
const router = express.Router();
const JournalEntry = require('../models/JournalEntry');
const Patient = require('../models/Patient');
const { requirePatientAccess } = require('../middleware/access');
// verifyToken is the auth check; the module exports { verifyToken, requireRole } (fixed at integration).
const { verifyToken: authMiddleware } = require('../middleware/authMiddleware');
const { generateDailyJournal } = require('../services/journalService');

/**
 * Journal Routes — Feature 6 (B8)
 */

// All routes require authentication
router.use(authMiddleware);

// Middleware to extract patient ID from query or body for access checks
const extractPatientParam = async (req, res, next) => {
  const patientId = req.query.patient || req.body.patientId || req.body.patient;
  if (!patientId) {
    return res.status(400).json({ status: 'error', message: 'patient query parameter or patientId in body is required' });
  }
  req.params.patientId = patientId;
  next();
};

/**
 * GET /api/v1/journal?patient=<patientId>&date=<YYYY-MM-DD>
 * Returns daily care journal entries for the patient.
 */
router.get('/', extractPatientParam, requirePatientAccess('view'), async (req, res) => {
  try {
    const { patient, date } = req.query;

    const query = { patient };

    if (date) {
      const d = new Date(date);
      d.setUTCHours(0, 0, 0, 0);
      const nextDay = new Date(d);
      nextDay.setDate(d.getDate() + 1);
      query.date = { $gte: d, $lt: nextDay };
    }

    const entries = await JournalEntry.find(query)
      .populate('lines.runId', 'trigger outcome flow')
      .sort({ date: -1 })
      .limit(30)
      .lean();

    return res.status(200).json({
      status: 'success',
      count: entries.length,
      data: entries,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/journal/generate
 * On-demand generation of today's journal for a patient.
 */
router.post('/generate', extractPatientParam, requirePatientAccess('approve'), async (req, res) => {
  try {
    const { patientId, date } = req.body;
    const result = await generateDailyJournal(patientId, date ? new Date(date) : new Date());

    const entry = await JournalEntry.findById(result.journalId)
      .populate('lines.runId', 'trigger outcome flow')
      .lean();

    return res.status(200).json({
      status: 'success',
      message: 'Journal generated successfully',
      data: entry,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * PATCH /api/v1/journal/:id/lines/:lineIndex/wrong
 * Caregiver action to mark/unmark a specific journal line as incorrect.
 */
router.patch('/:id/lines/:lineIndex/wrong', async (req, res) => {
  try {
    const { id, lineIndex } = req.params;
    const entry = await JournalEntry.findById(id);

    if (!entry) {
      return res.status(404).json({ status: 'error', message: 'Journal entry not found' });
    }

    // Check access
    req.params.patientId = entry.patient.toString();
    const { canAccess } = require('../middleware/access');
    const allowed = await canAccess(req.user.id, entry.patient, 'approve');
    if (!allowed) {
      return res.status(403).json({ status: 'error', message: 'Forbidden: requires approve role to flag journal lines' });
    }

    const idx = parseInt(lineIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= entry.lines.length) {
      return res.status(400).json({ status: 'error', message: `Invalid lineIndex: ${lineIndex}` });
    }

    // Toggle markedWrong
    entry.lines[idx].markedWrong = !entry.lines[idx].markedWrong;
    await entry.save();

    return res.status(200).json({
      status: 'success',
      message: `Line ${idx + 1} flagged as ${entry.lines[idx].markedWrong ? 'wrong' : 'accurate'}`,
      data: entry,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
