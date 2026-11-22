// Follow-ups for the caregiver (A4.3): what MedTime will ask her about on the next calls.
//   GET   /api/v1/followups?patientId=&status=open|closed|all   (view access)
//   PATCH /api/v1/followups/:id/close                           (approve access) — "no need to ask"
const express = require('express');
const mongoose = require('mongoose');
const FollowUp = require('../models/FollowUp');
const { verifyToken } = require('../middleware/authMiddleware');
const { canAccess } = require('../middleware/access');
const { CONCERN_WORDS } = require('../agent/flows/followups');

const router = express.Router();
const view = (f) => ({
  id: String(f._id), concern: f.concern, about: CONCERN_WORDS[f.concern] || f.concern, quote: f.quote,
  status: f.status, asks: f.asks, lastAnswer: f.lastAnswer || null, closedReason: f.closedReason || null,
  createdAt: f.createdAt, lastAskedAt: f.lastAskedAt || null, sourceRun: f.sourceRun ? String(f.sourceRun) : null,
});

router.get('/', verifyToken, async (req, res) => {
  try {
    const { patientId, status = 'open' } = req.query;
    if (!mongoose.isValidObjectId(patientId)) return res.status(400).json({ message: 'patientId is required' });
    if (!(await canAccess(req.user.id, patientId, 'view'))) return res.status(403).json({ message: 'Forbidden: insufficient access.' });
    const q = { patient: patientId };
    if (status !== 'all') q.status = status === 'closed' ? 'closed' : 'open';
    const list = await FollowUp.find(q).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ followUps: list.map(view) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.patch('/:id/close', verifyToken, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Not a valid id' });
    const f = await FollowUp.findById(req.params.id);
    if (!f) return res.status(404).json({ message: 'Follow-up not found' });
    if (!(await canAccess(req.user.id, String(f.patient), 'approve'))) return res.status(403).json({ message: 'Forbidden: insufficient access.' });
    if (f.status === 'open') Object.assign(f, { status: 'closed', closedReason: 'caregiver', closedAt: new Date(), closedBy: req.user.id });
    await f.save();
    res.json({ followUp: view(f) });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

module.exports = router;
