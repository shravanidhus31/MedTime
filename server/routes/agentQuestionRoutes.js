/**
 * Agent Question routes — B4 (contract C6)
 *
 * Endpoints for caregivers to view questions posed by agents (e.g. prescription
 * routine questions or dose clarifications) and submit answers.
 */

const express = require('express');
const AgentQuestion = require('../models/AgentQuestion');
const Patient = require('../models/Patient');
const { verifyToken } = require('../middleware/authMiddleware');
const { canAccess } = require('../middleware/access');

const router = express.Router();

// ─── GET /api/v1/agent/questions ────────────────────────────────────────────
// Returns questions for a patient. Query: ?patient=<patientId>&status=<pending|answered>
router.get('/', verifyToken, async (req, res) => {
  try {
    let { patient: patientId, status } = req.query;

    if (!patientId) {
      const patientDoc = await Patient.findOne({ user: req.user.id });
      if (patientDoc) patientId = patientDoc._id.toString();
    }

    if (!patientId) {
      return res.status(400).json({ message: 'patient query parameter required.' });
    }

    const ok = await canAccess(req.user.id, patientId, 'view');
    if (!ok) return res.status(403).json({ message: 'Forbidden.' });

    const filter = { patient: patientId };
    if (status) filter.status = status;

    const questions = await AgentQuestion.find(filter)
      .populate('answeredBy', 'name role')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json(questions);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// ─── POST /api/v1/agent/questions/:id/answer ────────────────────────────────
// Answer a pending question from the agent.
router.post('/:id/answer', verifyToken, async (req, res) => {
  try {
    const { answer } = req.body;
    if (!answer) return res.status(400).json({ message: 'answer string required in body.' });

    const question = await AgentQuestion.findById(req.params.id);
    if (!question) return res.status(404).json({ message: 'Question not found.' });

    if (question.status === 'answered') {
      return res.status(400).json({ message: 'Question already answered.' });
    }

    // Caregivers with at least 'approve' access can answer agent questions
    const ok = await canAccess(req.user.id, question.patient.toString(), 'approve');
    if (!ok) return res.status(403).json({ message: 'Forbidden.' });

    question.answer = answer;
    question.answeredBy = req.user.id;
    question.answeredAt = new Date();
    question.status = 'answered';
    await question.save();

    // The weekly review asked this before flagging a change (fix 8): run it again with the answer,
    // so the change is either explained or marked worth mentioning to the doctor.
    const { QUESTION_PREFIX, generateWeeklyReview } = require('../services/weeklyReviewService');
    if (String(question.question || '').startsWith(QUESTION_PREFIX)) {
      generateWeeklyReview(question.patient).catch((err) => console.error('[AgentQuestion] weekly review re-run failed:', err.message));
    }

    res.status(200).json({
      message: 'Answer recorded successfully.',
      question,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
