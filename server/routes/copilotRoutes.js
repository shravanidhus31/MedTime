const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { processCopilotQuery } = require('../services/copilotService');

router.use(authMiddleware);

/**
 * POST /api/v1/copilot/ask
 * Ask the Caregiver Copilot a question.
 */
router.post('/ask', async (req, res) => {
  try {
    const { message, mode, patientId } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ status: 'error', message: 'Message is required' });
    }

    const response = await processCopilotQuery({
      message,
      requestedMode: mode,
      patientId,
      userId: req.user.id,
    });

    return res.status(200).json({ status: 'success', data: response });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
