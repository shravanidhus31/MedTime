const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const multer = require('multer');
const Tesseract = require('tesseract.js');
// verifyToken is the auth check; the module exports { verifyToken, requireRole } (fixed at integration).
const { verifyToken: authMiddleware } = require('../middleware/authMiddleware');
const AgentRun = require('../models/AgentRun');
const Medicine = require('../models/Medicine');
const Patient = require('../models/Patient');
const RoutineProfile = require('../models/RoutineProfile');
const readPrescription = require('../agent/tools/readPrescription');
const { getProposalKind } = require('../agent/proposals');
const ProposedChange = require('../models/ProposedChange');

/**
 * OCR Routes — B12 (Prescription-to-Schedule Agent, Feature 8)
 *
 * Changes from original:
 * 1. 5MB file size limit enforced by multer.
 * 2. No auto-save: OCR result starts an agent run and read_prescription LLM tool.
 * 3. The client no longer pre-saves with stock 30.
 * 4. Conflicts and low-confidence lines are surfaced clearly.
 * 5. propose_change queues a new_schedule proposal at Level 1 (clear) or Level 2 (conflicts/low-confidence).
 */

// 5 MB file size limit (B12 requirement)
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const { fitToRoutine } = require('../services/scheduleFit');
const { canAccess } = require('../middleware/access');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Invalid file type. Please upload a JPG or PNG image of the prescription.'));
    }
    cb(null, true);
  },
});

router.use(authMiddleware);

/**
 * POST /api/v1/ocr/parse
 * Upload a prescription image → OCR → LLM extraction → agent run → proposal.
 */
router.post('/parse', upload.single('prescription'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image provided.' });
    }

    const patientId = req.body.patientId || req.query.patientId;
    if (!patientId) {
      return res.status(400).json({ status: 'error', message: 'patientId is required' });
    }

    if (!mongoose.isValidObjectId(patientId)) return res.status(400).json({ status: 'error', message: 'Not a valid patient id' });
    const patient = await Patient.findById(patientId).lean();
    if (!patient) {
      return res.status(404).json({ status: 'error', message: 'Patient not found' });
    }
    // Only someone who may approve changes for this patient can start a new schedule (review, 22 Nov:
    // any logged-in user could create proposals for any patient).
    if (!(await canAccess(req.user.id, String(patient._id), 'approve'))) {
      return res.status(403).json({ status: 'error', message: 'Forbidden: insufficient access.' });
    }

    // Fetch current active medicines for conflict detection
    const currentMedicines = await Medicine.find({
      patient: patientId,
      isActive: true,
    }).lean();

    console.log('📷 [OCR] Starting Tesseract OCR on prescription upload...');

    // Run OCR
    const { data: { text: ocrText } } = await Tesseract.recognize(
      req.file.buffer,
      'eng',
      { logger: (m) => { if (m.status === 'recognizing text') console.log(`OCR: ${Math.round(m.progress * 100)}%`); } }
    );

    console.log('📝 [OCR] Raw extracted text length:', ocrText.length);

    // Create agent run
    const agentRun = await AgentRun.create({
      trigger: 'prescription_upload',
      patient: patientId,
      flow: 'prescription_to_schedule',
      status: 'running',
      model: process.env.LLM_MODEL_SMART || 'groq/llama-3.3-70b-versatile',
      steps: [{
        step: 'ocr_complete',
        summary: `OCR extracted ${ocrText.split('\n').length} lines of text`,
        output: { textLength: ocrText.length },
      }],
    });

    // Run read_prescription tool (LLM or regex fallback)
    const extraction = await readPrescription.run(
      { ocrText, currentMedicines },
      { patientId, runId: agentRun._id }
    );

    agentRun.steps.push({
      step: 'prescription_extracted',
      summary: `Extracted ${extraction.total} medicine(s). Conflicts: ${extraction.hasConflicts}. Low confidence: ${extraction.hasLowConfidence}.`,
      output: extraction,
    });

    if (!extraction.ok || extraction.medicines.length === 0) {
      agentRun.status = 'failed';
      agentRun.outcome = 'No medicines could be extracted from the prescription';
      await agentRun.save();

      return res.status(422).json({
        status: 'error',
        message: 'Could not extract any medicine information from this image. Please try a clearer scan.',
        ocrText: ocrText.substring(0, 500),
        runId: agentRun._id,
      });
    }

    // Fit medicines to patient's routine profile
    const routine = await RoutineProfile.findOne({ patient: patientId }).lean();
    const fittedMedicines = fitToRoutine(extraction.medicines, routine);

    agentRun.steps.push({
      step: 'routine_fitting',
      summary: `Medicines fitted to routine profile (${routine ? 'profile found' : 'no profile, using defaults'})`,
      output: { fittedMedicines },
    });

    // Determine proposal level:
    // Level 1 (Caregiver) = all lines clear and no conflicts
    // Level 2 (Doctor) = any low-confidence or duplicate/strength change
    const proposalLevel = (extraction.hasConflicts || extraction.hasLowConfidence) ? 2 : 1;

    // Create the proposal (queued, no Medicine record created yet)
    const proposal = await ProposedChange.create({
      patient: patientId,
      kind: 'new_schedule',
      payload: {
        medicines: fittedMedicines,
        rawExtraction: extraction.medicines,
        ocrTextSample: ocrText.substring(0, 1000),
      },
      evidence: buildEvidenceSummary(extraction, fittedMedicines),
      level: proposalLevel,
      status: 'pending',
      createdByRun: agentRun._id,
    });

    agentRun.steps.push({
      step: 'proposal_created',
      summary: `Proposal created at Level ${proposalLevel}. Waiting for ${proposalLevel === 1 ? 'caregiver' : 'doctor'} approval.`,
      output: { proposalId: proposal._id, level: proposalLevel },
    });
    agentRun.status = 'pending_approval';
    agentRun.outcome = `New schedule proposed (Level ${proposalLevel})`;
    await agentRun.save();

    return res.status(200).json({
      status: 'success',
      message: `Prescription read successfully. ${proposalLevel === 1 ? 'Awaiting caregiver approval.' : 'Awaiting doctor review due to low-confidence or conflicting lines.'}`,
      runId: agentRun._id,
      proposalId: proposal._id,
      proposalLevel,
      medicines: fittedMedicines,
      conflicts: extraction.medicines.filter((m) => m.isDuplicate || m.isStrengthChange),
      timingConflicts: fittedMedicines.flatMap((m) => m.timingConflicts || []),
      lowConfidenceLines: extraction.medicines.filter(
        (m) => m.nameConfidence === 'low' || m.frequencyConfidence === 'low'
      ),
      hasConflicts: extraction.hasConflicts,
      hasLowConfidence: extraction.hasLowConfidence,
      routine: routine ? { sameEveryDay: routine.sameEveryDay } : null,
    });
  } catch (err) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        status: 'error',
        message: 'File too large. Maximum prescription image size is 5 MB.',
      });
    }
    console.error('[OCR] Error:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

const { generateRemindersForMedicine } = require('../jobs/reminderTopUpJob');

/**
 * GET /api/v1/ocr/proposals/:patientId
 * Get pending prescription proposals for a patient.
 */
router.get('/proposals/:patientId', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.patientId)) return res.status(400).json({ status: 'error', message: 'Not a valid patient id' });
    if (!(await canAccess(req.user.id, req.params.patientId, 'view'))) {
      return res.status(403).json({ status: 'error', message: 'Forbidden: insufficient access.' });
    }
    const proposals = await ProposedChange.find({
      patient: req.params.patientId,
      kind: 'new_schedule',
      status: { $in: ['pending', 'escalated'] }, // escalated ones wait for the doctor
    }).sort({ createdAt: -1 }).lean();

    return res.status(200).json({ status: 'success', proposals });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * Approve handler (shared by /proposals/:id/approve and /approve/:id)
 * Creates Medicine + auto-generates 7-day Reminder records.
 */
async function handleApproveProposal(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ status: 'error', message: 'Not a valid proposal id' });
    const proposal = await ProposedChange.findById(req.params.id);
    if (!proposal) return res.status(404).json({ status: 'error', message: 'Proposal not found' });
    // Level 1: the caregiver (or she herself) approves; Level 2 (lines it couldn't read, duplicates,
    // strength changes): a doctor approves (plan, approval levels). Before, anyone logged in could.
    const needed = proposal.level >= 2 || proposal.status === 'escalated' ? 'doctor' : 'approve';
    if (!(await canAccess(req.user.id, String(proposal.patient), needed))) {
      return res.status(403).json({ status: 'error', message: needed === 'doctor' ? "This prescription needs a doctor's review before it is added." : 'Forbidden: insufficient access.' });
    }
    if (!['pending', 'escalated'].includes(proposal.status)) {
      return res.status(400).json({ status: 'error', message: `Proposal is already ${proposal.status}` });
    }

    const medicines = proposal.payload?.medicines || [];
    const created = [];

    for (const med of medicines) {
      if (!med.name) continue; // Never create a medicine with no name

      const medicine = await Medicine.create({
        patient: proposal.patient,
        name: med.name,
        dosage: med.strength || med.dosage || 'As prescribed',
        type: 'tablet',
        frequency: med.frequency || 'once',
        scheduledTimes: med.scheduledTimes || ['08:00'],
        mealTiming: ['before', 'after', 'with', 'any'].includes(med.foodRule || med.mealTiming) ? (med.foodRule || med.mealTiming) : 'any',
        notificationType: 'sms',
        startDate: new Date(),
        tabletCount: 30,
        refillThreshold: 5,
        isActive: true,
        pillboxSlot: med.pillboxSlot || null,
        intervalDays: med.intervalDays || null,
        daysOfWeek: med.daysOfWeek || undefined,
      });
      created.push(medicine._id);

      // Immediately generate 7-day reminders for the newly created medicine
      try {
        await generateRemindersForMedicine(medicine);
      } catch (remErr) {
        console.warn(`[OCR Approve] Warning: Failed to pre-seed reminders for ${medicine.name}:`, remErr.message);
      }
    }

    proposal.status = 'approved';
    proposal.decidedBy = req.user.id;
    proposal.decidedAt = new Date();
    proposal.reason = req.body?.reason || 'Prescription approved by caregiver/doctor';
    await proposal.save();

    return res.status(200).json({
      status: 'success',
      message: `${created.length} medicine(s) created from prescription approval.`,
      medicinesCreated: created,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

router.post('/proposals/:id/approve', handleApproveProposal);
router.post('/approve/:id', handleApproveProposal);

/**
 * Escalate handler (shared by /proposals/:id/escalate and /escalate/:id)
 * Flags proposal for doctor review.
 */
async function handleEscalateProposal(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ status: 'error', message: 'Not a valid proposal id' });
    const proposal = await ProposedChange.findById(req.params.id);
    if (!proposal) return res.status(404).json({ status: 'error', message: 'Proposal not found' });
    if (!(await canAccess(req.user.id, String(proposal.patient), 'approve'))) {
      return res.status(403).json({ status: 'error', message: 'Forbidden: insufficient access.' });
    }
    if (proposal.status !== 'pending') {
      return res.status(400).json({ status: 'error', message: `Proposal is already ${proposal.status}` });
    }

    proposal.status = 'escalated';
    proposal.decidedBy = req.user.id;
    proposal.decidedAt = new Date();
    proposal.reason = req.body?.reason || 'Escalated to doctor for clinical confirmation';
    await proposal.save();

    return res.status(200).json({
      status: 'success',
      message: 'Prescription proposal escalated to doctor.',
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

router.post('/proposals/:id/escalate', handleEscalateProposal);
router.post('/escalate/:id', handleEscalateProposal);

// ─── Helpers ──────────────────────────────────────────────────────────────────

// The evidence text the caregiver sees on the proposal. Fitting to her routine and the food-rule
// check live in services/scheduleFit.js.
function buildEvidenceSummary(extraction, fitted = []) {
  const lines = [`Prescription scan extracted ${extraction.total} medicine(s).`];
  // Food rule vs her meals (B12): explained, with a suggested time; the caregiver decides.
  for (const m of fitted) for (const c of m.timingConflicts || []) lines.push(`⚠️ ${c.message}`);
  if (extraction.hasConflicts) {
    const conflicts = extraction.medicines.filter((m) => m.isDuplicate || m.isStrengthChange);
    for (const c of conflicts) {
      lines.push(`⚠️ ${c.name}: ${c.conflictNotes || (c.isDuplicate ? 'Duplicate of active medicine' : 'Strength change detected')}`);
    }
  }
  if (extraction.hasLowConfidence) {
    lines.push('⚠️ Some fields could not be read clearly from the image and have been left blank.');
  }
  return lines.join('\n');
}

module.exports = router;
