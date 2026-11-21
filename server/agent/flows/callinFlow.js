/**
 * Call-In Flow Handler — B11 (Feature 7: "Did I take my pills?")
 *
 * Implements the full callin question-answer loop per plan section 6.2.
 *
 * Rules:
 * 1. Registered patient numbers only. Unregistered callers get a short deflection.
 * 2. Question classification: doses | today | memory | other
 * 3. Dose taken → "Yes, at HH:MM. Next at HH:MM."  Never suggests taking again.
 * 4. Dose not recorded + still due → escalates to dose-check flow (double-dose protection).
 * 5. Dose not recorded + time passed → "Please don't take an extra one." Caregiver alerted.
 * 6. Memory/people questions → lookup_life_notes only. No invented answers.
 * 7. After one failed search, one follow-up question allowed. After that: "I'll ask [caregiver] to call you."
 * 8. >3 calls in 1 hour about the same dose → answer kindly + journal pattern line.
 *
 * This module runs in TEXT / BROWSER simulation. The Twilio webhook wires it in
 * when incoming voice calls are supported (voiceIncoming.js).
 */

const Reminder = require('../../models/Reminder');
const Medicine = require('../../models/Medicine');
const Patient = require('../../models/Patient');
const User = require('../../models/User');
const AgentRun = require('../../models/AgentRun');
const lookupLifeNotes = require('../tools/lookupLifeNotes');
const { generateDailyJournal } = require('../../services/journalService');

// In-memory throttle store: { key: [timestamps] }
const callThrottle = new Map();

/**
 * Classify the patient's question into one of the four intent categories.
 */
function classifyQuestion(text) {
  if (!text) return 'other';
  const lower = text.toLowerCase();

  const dosePatterns = [
    /did i take/, /have i taken/, /did i have my/, /took my.*pill/,
    /medicine.*today/, /pill.*today/, /tablet.*today/, /dose.*today/,
    /morning.*pill/, /evening.*pill/, /night.*pill/, /afternoon.*pill/,
  ];
  const memoryPatterns = [
    /who is/, /where is/, /who was/, /what is.*name/, /tell me about/,
    /my daughter/, /my son/, /priya/, /daughter/, /family/,
  ];
  const routinePatterns = [
    /what.*routine/, /daily.*schedule/, /when do i/, /morning routine/,
    /wake up/, /breakfast time/, /morning.*schedule/, /schedule.*today/,
    /my.*schedule/, /what.*schedule/,
  ];

  if (dosePatterns.some((p) => p.test(lower))) return 'doses';
  if (memoryPatterns.some((p) => p.test(lower))) return 'memory';
  if (routinePatterns.some((p) => p.test(lower))) return 'today';
  return 'other';
}

/**
 * Get the most recent reminder(s) for today in IST for a patient.
 */
async function getTodayReminders(patientId) {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);

  const startOfDayIST = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0, 0)
  );
  const endOfDayIST = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 23, 59, 59, 999)
  );

  // Convert back to UTC for query
  const startUTC = new Date(startOfDayIST.getTime() - istOffset);
  const endUTC = new Date(endOfDayIST.getTime() - istOffset);

  return Reminder.find({
    patient: patientId,
    scheduledTime: { $gte: startUTC, $lte: endUTC },
  })
    .populate('medicine', 'name dosage scheduledTimes')
    .sort({ scheduledTime: 1 })
    .lean();
}

/**
 * Check call throttle — returns true if the patient has called >3 times
 * about the same dose in the past hour.
 */
function checkThrottle(patientId, reminderId) {
  const key = `${patientId}:${reminderId}`;
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  const history = (callThrottle.get(key) || []).filter((t) => now - t < oneHour);
  history.push(now);
  callThrottle.set(key, history);

  return history.length > 3;
}

/**
 * Format a time (UTC Date) as a human-readable IST string.
 */
function formatTimeIST(date) {
  if (!date) return null;
  return new Date(date).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Find the next scheduled dose time from the medicine's scheduledTimes,
 * checking future reminders with pending status.
 */
async function findNextDoseTime(medicine, patientId) {
  const nextReminder = await Reminder.findOne({
    medicine: medicine._id,
    patient: patientId,
    status: 'pending',
    scheduledTime: { $gt: new Date() },
  })
    .sort({ scheduledTime: 1 })
    .lean();

  return nextReminder ? formatTimeIST(nextReminder.scheduledTime) : null;
}

/**
 * Main callin flow handler.
 *
 * @param {object} ctx - { patientId, userId, question, runId }
 * @returns {object} { reply, done, action?, reminderId? }
 */
async function handleCallinQuestion(ctx) {
  const { patientId, question, runId } = ctx;

  if (!question || !question.trim()) {
    return {
      reply: 'I didn\'t quite catch that. Could you please ask your question again?',
      done: false,
    };
  }

  const intent = classifyQuestion(question);

  // ─── DOSE QUERIES ──────────────────────────────────────────────────────────
  if (intent === 'doses') {
    const reminders = await getTodayReminders(patientId);

    if (reminders.length === 0) {
      return {
        reply: 'I don\'t see any medicines scheduled for today. Please check with your caregiver if something has changed.',
        done: true,
      };
    }

    // Extract medicine name from question for specific lookups
    const lowerQ = question.toLowerCase();
    const matchedReminder = reminders.find((r) => {
      const medName = (r.medicine?.name || '').toLowerCase();
      return medName && lowerQ.includes(medName.split(' ')[0]);
    });

    // Use matched reminder or fall back to most recent overdue/pending one
    const targetReminder = matchedReminder || reminders.find((r) =>
      r.status === 'taken' || r.status === 'missed' || r.status === 'alerted'
    ) || reminders[0];

    // Throttle check
    const isRepeating = checkThrottle(patientId.toString(), targetReminder._id.toString());
    if (isRepeating) {
      // Log pattern to journal (async, don't await in call path)
      logRepeatPattern(patientId, targetReminder, runId).catch(() => { });
      return {
        reply: `Yes, I already told you about this. ${targetReminder.status === 'taken'
            ? 'You\'ve taken this medicine.'
            : 'This dose hasn\'t been recorded yet.'
          } If you\'re unsure, please ask your caregiver — I\'ve sent them a note.`,
        done: true,
        action: 'notify_caregiver',
      };
    }

    // Taken ✓
    if (targetReminder.status === 'taken') {
      const takenAt = formatTimeIST(targetReminder.confirmedAt || targetReminder.scheduledTime);
      const nextTime = await findNextDoseTime(targetReminder.medicine, patientId);
      return {
        reply: `Yes, you took ${targetReminder.medicine?.name || 'your medicine'} at ${takenAt}.${nextTime ? ` Your next dose is at ${nextTime}.` : ''}`,
        done: true,
      };
    }

    // Skipped
    if (targetReminder.status === 'skipped') {
      const scheduledAt = formatTimeIST(targetReminder.scheduledTime);
      return {
        reply: `The ${scheduledAt} dose of ${targetReminder.medicine?.name || 'your medicine'} was recorded as skipped. Please let your caregiver know if you need help.`,
        done: true,
        action: 'notify_caregiver',
      };
    }

    // Not recorded + still due (time is in the future or within the last 15 min)
    const scheduledTime = new Date(targetReminder.scheduledTime);
    const now = new Date();
    const stillDue = scheduledTime > new Date(now.getTime() - 15 * 60 * 1000);

    if ((targetReminder.status === 'pending' || targetReminder.status === 'alerted') && stillDue) {
      return {
        reply: `I haven\'t recorded that dose yet. ${formatTimeIST(targetReminder.scheduledTime)} dose of ${targetReminder.medicine?.name || 'your medicine'} is still due. Shall I check if it's time now?`,
        done: false,
        action: 'start_dose_flow',
        reminderId: targetReminder._id,
      };
    }

    // Not recorded + time has passed → SAFETY RULE: never suggest taking extra
    if (targetReminder.status === 'pending' || targetReminder.status === 'missed') {
      const scheduledAt = formatTimeIST(targetReminder.scheduledTime);
      return {
        reply: `The ${scheduledAt} dose of ${targetReminder.medicine?.name || 'your medicine'} wasn't recorded. Please do not take an extra one — I'll let your caregiver know right away.`,
        done: true,
        action: 'notify_caregiver',
        reminderId: targetReminder._id,
      };
    }

    return {
      reply: `I don't have a clear record of that dose. Please check with your caregiver to be safe.`,
      done: true,
      action: 'notify_caregiver',
    };
  }

  // ─── MEMORY / PEOPLE QUERIES ──────────────────────────────────────────────
  if (intent === 'memory') {
    const result = await lookupLifeNotes.run(
      { query: question, kind: 'any' },
      { patientId }
    );

    if (result.ok && result.found && result.notes.length > 0) {
      const topNote = result.notes[0];
      return {
        reply: topNote.text,
        done: true,
        source: 'life_notes',
        noteId: topNote.id,
      };
    }

    // Not found — one follow-up allowed
    return {
      reply: 'I want to make sure I give you the right information. Could you tell me a little more about who or what you\'re asking about?',
      done: false,
      requiresFollowUp: true,
    };
  }

  // ─── ROUTINE / TODAY QUERIES ──────────────────────────────────────────────
  if (intent === 'today') {
    const result = await lookupLifeNotes.run(
      { query: question, kind: 'routine' },
      { patientId }
    );

    if (result.ok && result.found) {
      return {
        reply: result.notes[0].text,
        done: true,
        source: 'life_notes',
      };
    }
  }

  // ─── FALLBACK / OTHER ─────────────────────────────────────────────────────
  return {
    reply: 'I\'m not sure I can answer that right now. I\'ll ask your caregiver to call you back with the answer.',
    done: true,
    action: 'notify_caregiver',
  };
}

/**
 * Logs a repeat-call pattern line to the daily care journal.
 * Called async, errors swallowed so they don't block the call path.
 */
async function logRepeatPattern(patientId, reminder, runId) {
  try {
    const { generateDailyJournal } = require('../../services/journalService');
    const writeJournal = require('../tools/writeJournal');
    await writeJournal.run(
      {
        lines: [{
          text: `Patient asked about the same dose (${reminder.medicine?.name || 'medicine'}) more than 3 times in one hour. Pattern logged for caregiver review.`,
          source: 'agent_noticed',
          runId: runId || null,
        }],
      },
      { patientId: patientId.toString(), runId: runId?.toString() || null }
    );
  } catch (err) {
    console.error('[CallinFlow] Error logging repeat pattern:', err.message);
  }
}

module.exports = {
  handleCallinQuestion,
  classifyQuestion,
  getTodayReminders,
  checkThrottle,
  callThrottle,
};
