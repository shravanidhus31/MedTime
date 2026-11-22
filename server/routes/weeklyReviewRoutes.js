const express = require('express');
const router = express.Router();
const WeeklyReview = require('../models/WeeklyReview');
// verifyToken is the auth check; the module exports { verifyToken, requireRole } (fixed at integration).
const { verifyToken: authMiddleware } = require('../middleware/authMiddleware');
const { requirePatientAccess, canAccess } = require('../middleware/access');
const { generateWeeklyReview } = require('../services/weeklyReviewService');

router.use(authMiddleware);

/**
 * GET /api/v1/weekly-review/:patientId
 * Get weekly reviews for a patient.
 */
router.get('/:patientId', requirePatientAccess('view'), async (req, res) => {
  try {
    const reviews = await WeeklyReview.find({ patient: req.params.patientId })
      .sort({ weekEndDate: -1 })
      .limit(12)
      .lean();

    return res.status(200).json({ status: 'success', reviews });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/weekly-review/generate/:patientId
 * Manually trigger a weekly review run.
 */
router.post('/generate/:patientId', requirePatientAccess('approve'), async (req, res) => {
  try {
    const review = await generateWeeklyReview(req.params.patientId);
    return res.status(201).json({ status: 'success', review });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/weekly-review/:id/feedback
 * Caregiver feedback (adjusts threshold margins).
 */
router.post('/:id/feedback', async (req, res) => {
  try {
    const { markedAccurate, caregiverNotes } = req.body;
    let { adjustedMarginPercent } = req.body;
    if (!require('mongoose').isValidObjectId(req.params.id)) return res.status(400).json({ status: 'error', message: 'Not a valid id' });
    const review = await WeeklyReview.findById(req.params.id);
    if (!review) return res.status(404).json({ status: 'error', message: 'Review not found' });
    // (22 Nov: anyone logged in could change any patient's review)
    if (!(await canAccess(req.user.id, String(review.patient), 'approve'))) return res.status(403).json({ status: 'error', message: 'Forbidden: insufficient access.' });
    // "Not accurate" with no margin given: the next review needs a bigger change before it speaks up
    if (markedAccurate === false && adjustedMarginPercent === undefined) adjustedMarginPercent = Math.min(60, (review.marginPercent || 25) + 10);

    review.caregiverFeedback = {
      markedAccurate: markedAccurate ?? review.caregiverFeedback?.markedAccurate,
      caregiverNotes: caregiverNotes || review.caregiverFeedback?.caregiverNotes,
      adjustedMarginPercent: adjustedMarginPercent || review.caregiverFeedback?.adjustedMarginPercent || 25,
    };

    await review.save();
    return res.status(200).json({ status: 'success', review });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
