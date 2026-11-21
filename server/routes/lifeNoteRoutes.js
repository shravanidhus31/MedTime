const express = require('express');
const router = express.Router();
const LifeNote = require('../models/LifeNote');
const { requirePatientAccess, canAccess } = require('../middleware/access');
const authMiddleware = require('../middleware/authMiddleware');

/**
 * Life Notes Routes — Feature 7 (B9: Memory Graph)
 *
 * Stores biographical details, people, places, daily routines, and sensitive
 * topic guidelines ("How to answer questions about...") for dementia patients.
 */

router.use(authMiddleware);

// Middleware to extract patient ID for authorization checks
const extractPatientParam = async (req, res, next) => {
  const patientId = req.query.patient || req.body.patientId || req.body.patient;
  if (!patientId) {
    return res.status(400).json({ status: 'error', message: 'patient query param or body.patientId is required' });
  }
  req.params.patientId = patientId;
  next();
};

/**
 * GET /api/v1/life-notes?patient=<patientId>&kind=<kind>&approved=<bool>
 * Returns all life notes matching the filter.
 */
router.get('/', extractPatientParam, requirePatientAccess('view'), async (req, res) => {
  try {
    const { patient, kind, approved } = req.query;

    const query = { patient };
    if (kind) query.kind = kind;
    if (approved !== undefined) query.approved = approved === 'true';

    const notes = await LifeNote.find(query)
      .populate('writtenBy', 'name email role')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      status: 'success',
      count: notes.length,
      data: notes,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/life-notes
 * Create a new life note. Caregiver notes start approved=true by default.
 */
router.post('/', extractPatientParam, requirePatientAccess('approve'), async (req, res) => {
  try {
    const { patientId, patient, kind, title, text, linkedRecordingId, approved } = req.body;
    const targetPatient = patientId || patient;

    if (!kind || !title || !text) {
      return res.status(400).json({ status: 'error', message: 'kind, title, and text are required fields' });
    }

    const validKinds = ['person', 'place', 'routine', 'event', 'topic_answer'];
    if (!validKinds.includes(kind)) {
      return res.status(400).json({ status: 'error', message: `Invalid kind. Must be one of: ${validKinds.join(', ')}` });
    }

    const note = await LifeNote.create({
      patient: targetPatient,
      writtenBy: req.user.id,
      kind,
      title: title.trim(),
      text: text.trim(),
      linkedRecordingId: linkedRecordingId || null,
      approved: approved !== undefined ? Boolean(approved) : true,
    });

    return res.status(201).json({
      status: 'success',
      message: 'Life note created successfully',
      data: note,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * PATCH /api/v1/life-notes/:id/approve
 * Approves a pending note (e.g. one drafted by an agent observation).
 */
router.patch('/:id/approve', async (req, res) => {
  try {
    const note = await LifeNote.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ status: 'error', message: 'Life note not found' });
    }

    const allowed = await canAccess(req.user.id, note.patient, 'approve');
    if (!allowed) {
      return res.status(403).json({ status: 'error', message: 'Forbidden: requires approve role to approve life notes' });
    }

    note.approved = true;
    await note.save();

    return res.status(200).json({
      status: 'success',
      message: 'Life note approved',
      data: note,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * PUT /api/v1/life-notes/:id
 * Updates an existing life note.
 */
router.put('/:id', async (req, res) => {
  try {
    const note = await LifeNote.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ status: 'error', message: 'Life note not found' });
    }

    const allowed = await canAccess(req.user.id, note.patient, 'approve');
    if (!allowed) {
      return res.status(403).json({ status: 'error', message: 'Forbidden: requires approve role to edit life notes' });
    }

    const { kind, title, text, linkedRecordingId } = req.body;
    if (kind) {
      const validKinds = ['person', 'place', 'routine', 'event', 'topic_answer'];
      if (!validKinds.includes(kind)) {
        return res.status(400).json({ status: 'error', message: `Invalid kind: ${kind}` });
      }
      note.kind = kind;
    }
    if (title) note.title = title.trim();
    if (text) note.text = text.trim();
    if (linkedRecordingId !== undefined) note.linkedRecordingId = linkedRecordingId;

    await note.save();

    return res.status(200).json({
      status: 'success',
      message: 'Life note updated successfully',
      data: note,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * DELETE /api/v1/life-notes/:id
 * Removes a life note.
 */
router.delete('/:id', async (req, res) => {
  try {
    const note = await LifeNote.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ status: 'error', message: 'Life note not found' });
    }

    const allowed = await canAccess(req.user.id, note.patient, 'approve');
    if (!allowed) {
      return res.status(403).json({ status: 'error', message: 'Forbidden: requires approve role to delete life notes' });
    }

    await LifeNote.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      status: 'success',
      message: 'Life note deleted successfully',
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
