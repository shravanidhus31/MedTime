const express = require('express');
const router = express.Router();
const multer = require('multer');
const Tesseract = require('tesseract.js');
const authMiddleware = require('../middleware/authMiddleware');
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

    const patient = await Patient.findById(patientId).lean();
    if (!patient) {
      return res.status(404).json({ status: 'error', message: 'Patient not found' });
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
      evidence: buildEvidenceSummary(extraction),
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

/**
 * POST /api/v1/ocr/proposals/:id/approve
 * Approve a prescription proposal → creates Medicine + Reminder records.
 * Respects existing proposal routes for Level 1 / Level 2 gating.
 */
router.post('/proposals/:id/approve', async (req, res) => {
  try {
    const proposal = await ProposedChange.findById(req.params.id);
    if (!proposal) return res.status(404).json({ status: 'error', message: 'Proposal not found' });
    if (proposal.status !== 'pending') {
      return res.status(400).json({ status: 'error', message: `Proposal is already ${proposal.status}` });
    }

    const { medicines } = proposal.payload;
    const created = [];

    for (const med of medicines) {
      if (!med.name) continue; // Never create a medicine with no name

      const medicine = await Medicine.create({
        patient: proposal.patient,
        name: med.name,
        dosage: med.strength || 'As prescribed',
        type: 'tablet',
        frequency: med.frequency || 'once',
        scheduledTimes: med.scheduledTimes || ['08:00'],
        mealTiming: med.foodRule || 'any',
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
    }

    proposal.status = 'approved';
    proposal.decidedBy = req.user.id;
    proposal.decidedAt = new Date();
    proposal.reason = req.body.reason || 'Prescription approved by caregiver/doctor';
    await proposal.save();

    return res.status(200).json({
      status: 'success',
      message: `${created.length} medicine(s) created from prescription approval.`,
      medicinesCreated: created,
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fits extracted medicines into the patient's daily routine schedule.
 * Maps food rules (before/after/with breakfast|lunch|dinner) to actual IST times.
 */
function fitToRoutine(medicines, routine) {
  const defaults = {
    wake: '07:00',
    breakfast: '08:00',
    lunch: '13:00',
    dinner: '20:00',
    bed: '22:00',
  };

  const schedule = routine?.weekday || defaults;

  return medicines.map((med) => {
    if (!med.name) return { ...med, scheduledTimes: null, conflict: 'no_name' };

    const times = [];
    const conflicts = [];
    const freq = med.frequency;

    // Map frequency + food rule to actual scheduled times
    if (freq === 'once') {
      const time = resolveTime(med.foodRule, schedule, 'morning');
      if (!time.valid) conflicts.push(time.conflict);
      times.push(time.time);
    } else if (freq === 'twice') {
      const morning = resolveTime(med.foodRule, schedule, 'morning');
      const evening = resolveTime(med.foodRule, schedule, 'evening');
      if (!morning.valid) conflicts.push(morning.conflict);
      if (!evening.valid) conflicts.push(evening.conflict);
      times.push(morning.time, evening.time);
    } else if (freq === 'thrice') {
      times.push(
        resolveTime(med.foodRule, schedule, 'morning').time,
        resolveTime(med.foodRule, schedule, 'afternoon').time,
        resolveTime(med.foodRule, schedule, 'evening').time,
      );
    } else {
      // Default: breakfast time
      times.push(schedule.breakfast || defaults.breakfast);
    }

    return {
      ...med,
      scheduledTimes: times,
      conflicts: conflicts.length > 0 ? conflicts : null,
    };
  });
}

function resolveTime(foodRule, schedule, period) {
  const defaults = { morning: '08:00', afternoon: '13:00', evening: '19:00', night: '21:00' };

  if (!foodRule || foodRule === 'any') {
    return { time: defaults[period] || '08:00', valid: true };
  }

  if (foodRule === 'before') {
    if (period === 'morning') return { time: addMinutes(schedule.breakfast || '08:00', -15), valid: true };
    if (period === 'afternoon') return { time: addMinutes(schedule.lunch || '13:00', -15), valid: true };
    if (period === 'evening') return { time: addMinutes(schedule.dinner || '20:00', -15), valid: true };
  }
  if (foodRule === 'after') {
    if (period === 'morning') return { time: addMinutes(schedule.breakfast || '08:00', 30), valid: true };
    if (period === 'afternoon') return { time: addMinutes(schedule.lunch || '13:00', 30), valid: true };
    if (period === 'evening') return { time: addMinutes(schedule.dinner || '20:00', 30), valid: true };
  }
  if (foodRule === 'with') {
    if (period === 'morning') return { time: schedule.breakfast || '08:00', valid: true };
    if (period === 'afternoon') return { time: schedule.lunch || '13:00', valid: true };
    if (period === 'evening') return { time: schedule.dinner || '20:00', valid: true };
  }

  return { time: defaults[period] || '08:00', valid: true };
}

function addMinutes(timeStr, minutes) {
  if (!timeStr || !timeStr.includes(':')) return timeStr;
  const [h, m] = timeStr.split(':').map(Number);
  const totalMinutes = h * 60 + m + minutes;
  const newH = Math.floor(((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60) / 60);
  const newM = ((totalMinutes % 60) + 60) % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function buildEvidenceSummary(extraction) {
  const lines = [`Prescription scan extracted ${extraction.total} medicine(s).`];
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
