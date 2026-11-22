const express = require('express');
const router = express.Router();
const WeeklyReview = require('../models/WeeklyReview');
const authMiddleware = require('../middleware/authMiddleware');
const { requirePatientAccess } = require('../middleware/access');
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
    const { markedAccurate, caregiverNotes, adjustedMarginPercent } = req.body;
    const review = await WeeklyReview.findById(req.params.id);
    if (!review) return res.status(404).json({ status: 'error', message: 'Review not found' });

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
