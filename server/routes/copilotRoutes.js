const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
// verifyToken is the auth check; the module exports { verifyToken, requireRole } (fixed at integration).
const { verifyToken: authMiddleware } = require('../middleware/authMiddleware');
const { canAccess } = require('../middleware/access');
const { processCopilotQuery } = require('../services/copilotService');

router.use(authMiddleware);

/**
 * POST /api/v1/copilot/ask  { message, patientId, mode? }
 * The caregiver copilot (Feature 2, fix 9): answers from her records and the guidance library,
 * released only after two safety reviews. The caller needs view access to that patient (22 Nov:
 * anyone logged in could ask, and the patient was ignored).
 * → { status, data: { mode, reply, citations, released, reviews, runId, proposedAction, source } }
 */
router.post('/ask', async (req, res) => {
  try {
    const { message, mode, patientId } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ status: 'error', message: 'Message is required' });
    }
    if (message.length > 1000) return res.status(400).json({ status: 'error', message: 'Please keep the question under 1000 characters.' });
    if (!mongoose.isValidObjectId(patientId)) return res.status(400).json({ status: 'error', message: 'patientId is required' });
    if (!(await canAccess(req.user.id, String(patientId), 'view'))) {
      return res.status(403).json({ status: 'error', message: 'Forbidden: insufficient access.' });
    }
    const response = await processCopilotQuery({ message, requestedMode: mode, patientId, userId: req.user.id });
    return res.status(200).json({ status: 'success', data: response });
  } catch (err) {
    console.error('[copilot] failed:', err.message);
    return res.status(500).json({ status: 'error', message: 'The copilot could not answer just now.' });
  }
});

module.exports = router;
