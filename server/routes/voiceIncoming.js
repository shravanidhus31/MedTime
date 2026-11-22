const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Patient = require('../models/Patient');
const AgentRun = require('../models/AgentRun');
// verifyToken is the auth check; the module exports { verifyToken, requireRole } (fixed at integration).
const { verifyToken: authMiddleware } = require('../middleware/authMiddleware');
const { handleCallinQuestion } = require('../agent/flows/callinFlow');
// Twilio-facing routes need a valid X-Twilio-Signature (A1.1), like /webhooks.
const { verifyTwilioSignature } = require('../middleware/twilioSignature');

/**
 * Voice Incoming Routes — B11 (Feature 7)
 *
 * Two entry points:
 * 1. POST /api/v1/voice/incoming — Twilio webhook (signature checked) for real phone calls.
 *    Registered patient numbers only. Unregistered callers hear a deflection message.
 * 2. POST /api/v1/voice/text-simulate — Authenticated text simulation for development
 *    and browser testing (no Twilio required).
 *
 * Both delegate to the same callinFlow handler (plan section 6.2).
 */

// ─── TWILIO INCOMING CALL WEBHOOK ─────────────────────────────────────────────

router.post('/incoming', verifyTwilioSignature, async (req, res) => {
  const callerPhone = req.body?.From || req.body?.Caller || '';

  // Strip country code for phone number comparison
  const normalizedPhone = callerPhone.replace(/^\+91/, '').replace(/\D/g, '');

  if (!normalizedPhone) {
    // Hidden caller ID or no From field
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">I'm sorry, I cannot identify your number. Please contact your caregiver directly.</Say>
  <Hangup/>
</Response>`);
  }

  try {
    // Look up registered patient by phone
    // numbers are stored with or without +91
    const user = await User.findOne({ phone: { $in: [normalizedPhone, `+91${normalizedPhone}`, `91${normalizedPhone}`] }, role: 'patient' }).lean();
    if (!user || user.role !== 'patient') {
      // Not a registered patient
      return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">This number is not registered as a patient in our system. Please contact your caregiver for assistance.</Say>
  <Hangup/>
</Response>`);
    }

    const patient = await Patient.findOne({ user: user._id }).lean();
    if (!patient) {
      return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">We couldn't find your patient profile. Please contact your caregiver.</Say>
  <Hangup/>
</Response>`);
    }

    // The call-in runs on the agent runtime (A3.5 + fix 4), the same flow as the browser call:
    // dose questions from the log, a due dose handed to the dose flow in this call, one follow-up,
    // red flags. Before, this path used its own run and a fixed Gather loop.
    const { initAgent } = require('../agent');
    initAgent();
    const { startCallinCall } = require('../agent/flows/callin');
    const { openingTwiml } = require('./voiceAgentRoutes');
    const call = await startCallinCall({ patientId: patient._id, trigger: 'callin', channel: 'phone' });
    console.log(`📞 [VoiceIncoming] Call-in from ${user.name} (run ${call.runId}, CallSid ${req.body.CallSid || '-'}).`);
    return res.type('text/xml').send(await openingTwiml({ sessionId: call.sessionId, actions: call.actions, callSid: req.body.CallSid }));
  } catch (err) {
    console.error('[VoiceIncoming] Error handling incoming call:', err.message);
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">Something went wrong. Please try again or contact your caregiver directly.</Say>
  <Hangup/>
</Response>`);
  }
});

// ─── TWILIO TURN HANDLER (after Gather STT) ───────────────────────────────────

router.post('/twilio-turn', verifyTwilioSignature, async (req, res) => {
  const { runId, patientId } = req.query;
  const spokenText = req.body?.SpeechResult || '';

  try {
    const result = await handleCallinQuestion({
      patientId,
      question: spokenText,
      runId,
    });

    // Log step
    if (runId) {
      await AgentRun.findByIdAndUpdate(runId, {
        $push: {
          steps: {
            step: 'callin_turn',
            summary: `Patient said: "${spokenText.substring(0, 80)}"`,
            output: { reply: result.reply, intent: result.intent, done: result.done },
          },
        },
        ...(result.done ? { status: 'completed', outcome: result.action || 'answered' } : {}),
      });
    }

    if (result.done) {
      return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">${escapeXml(result.reply)}</Say>
  <Hangup/>
</Response>`);
    }

    // Another question needed
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="/api/v1/voice/twilio-turn?runId=${runId}&amp;patientId=${patientId}" speechTimeout="3" language="en-IN">
    <Say voice="woman" language="en-IN">${escapeXml(result.reply)}</Say>
  </Gather>
  <Hangup/>
</Response>`);
  } catch (err) {
    console.error('[VoiceTwilioTurn] Error:', err.message);
    return res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="woman" language="en-IN">I'm having trouble right now. Please contact your caregiver. Goodbye!</Say>
  <Hangup/>
</Response>`);
  }
});

// ─── TEXT SIMULATION ENDPOINT (browser / dev mode) ────────────────────────────

/**
 * POST /api/v1/voice/text-simulate
 * Body: { patientId, question, sessionId? }
 * Returns JSON with the agent's reply, intent, and any action required.
 *
 * Uses the same callinFlow as the Twilio path so outcomes are identical.
 */
router.post('/text-simulate', authMiddleware, async (req, res) => {
  const { patientId, question, sessionId } = req.body;

  if (!patientId || !question) {
    return res.status(400).json({ status: 'error', message: 'patientId and question are required' });
  }

  try {
    // Create or reuse an AgentRun for this simulation session
    let agentRun;
    if (sessionId) {
      agentRun = await AgentRun.findById(sessionId);
    }
    if (!agentRun) {
      agentRun = await AgentRun.create({
        trigger: 'callin',
        patient: patientId,
        flow: 'callin',
        status: 'running',
        model: 'callin_flow_text_sim',
        steps: [{ step: 'text_simulation_start', summary: 'Text simulation of callin flow started' }],
      });
    }

    const result = await handleCallinQuestion({
      patientId,
      question,
      runId: agentRun._id,
    });

    // Log this turn
    await AgentRun.findByIdAndUpdate(agentRun._id, {
      $push: {
        steps: {
          step: 'callin_turn',
          summary: `Patient asked: "${question.substring(0, 80)}"`,
          output: result,
        },
      },
      ...(result.done ? { status: 'completed', outcome: result.action || 'answered' } : {}),
    });

    return res.status(200).json({
      status: 'success',
      sessionId: agentRun._id,
      reply: result.reply,
      done: result.done,
      action: result.action || null,
      reminderId: result.reminderId || null,
      source: result.source || null,
    });
  } catch (err) {
    console.error('[VoiceTextSimulate] Error:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── ROUTINE PROFILE ENDPOINTS ────────────────────────────────────────────────

const RoutineProfile = require('../models/RoutineProfile');
const { requirePatientAccess } = require('../middleware/access');

router.use(authMiddleware);

/**
 * GET /api/v1/voice/routine?patient=<patientId>
 * Returns the patient's daily routine profile.
 */
router.get('/routine', async (req, res) => {
  const patientId = req.query.patient;
  if (!patientId) return res.status(400).json({ status: 'error', message: 'patient param required' });

  try {
    const profile = await RoutineProfile.findOne({ patient: patientId }).lean();
    return res.status(200).json({ status: 'success', data: profile || null });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/v1/voice/routine
 * Creates or updates the patient's daily routine schedule.
 */
router.post('/routine', async (req, res) => {
  const { patientId, patient, weekday, weekend, sameEveryDay, pillbox } = req.body;
  const targetPatient = patientId || patient;
  if (!targetPatient) return res.status(400).json({ status: 'error', message: 'patientId required' });

  try {
    const profile = await RoutineProfile.findOneAndUpdate(
      { patient: targetPatient },
      {
        patient: targetPatient,
        weekday: weekday || {},
        weekend: weekend || {},
        sameEveryDay: sameEveryDay !== undefined ? sameEveryDay : true,
        pillbox: pillbox || { type: 'none', slots: [] },
        confirmed: true,
      },
      { upsert: true, new: true, runValidators: true }
    );
    return res.status(200).json({ status: 'success', message: 'Routine profile saved', data: profile });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = router;
