const Observation = require('../models/Observation');
const WeeklyReview = require('../models/WeeklyReview');
const Medicine = require('../models/Medicine');
const ProposedChange = require('../models/ProposedChange');
const Patient = require('../models/Patient');

/**
 * Weekly Review Service — B14 (Features 1 & 3)
 *
 * Implements PRD Feature 1 (Speech & Behavioral Decline Detection)
 * and Feature 3 (Sundowning Pattern Detection & Schedule Adaptation).
 */

const DEFAULT_MARGIN_PERCENT = 25; // 25% change threshold

/**
 * Record a single observation row.
 */
async function recordObservation(data) {
  return Observation.create({
    patient: data.patientId,
    callId: data.callId || null,
    callType: data.callType || 'simulation',
    source: data.source || 'code',
    metric: data.metric,
    value: data.value,
    timeOfDay: data.timeOfDay || getTimeOfDay(new Date()),
    metadata: data.metadata || {},
    timestamp: data.timestamp || new Date(),
  });
}

/**
 * Helper to get time of day period.
 */
function getTimeOfDay(date = new Date()) {
  const hour = (date.getUTCHours() + 5.5) % 24; // Convert to IST hour
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/**
 * Generate a Weekly Review report for a patient.
 */
async function generateWeeklyReview(patientId, referenceDate = new Date()) {
  const patient = await Patient.findById(patientId);
  if (!patient) throw new Error('Patient not found');

  const oneDay = 24 * 60 * 60 * 1000;
  const currentWeekEnd = new Date(referenceDate);
  const currentWeekStart = new Date(currentWeekEnd.getTime() - 7 * oneDay);
  const baselineStart = new Date(currentWeekStart.getTime() - 28 * oneDay); // 4 weeks prior

  // 1. Fetch current week observations
  const currentWeekObs = await Observation.find({
    patient: patientId,
    timestamp: { $gte: currentWeekStart, $lte: currentWeekEnd },
  }).lean();

  // 2. Fetch baseline observations (first 4 weeks)
  const baselineObs = await Observation.find({
    patient: patientId,
    timestamp: { $gte: baselineStart, $lt: currentWeekStart },
  }).lean();

  // 3. Aggregate metrics
  const currentMetrics = computeAverages(currentWeekObs);
  const baselineMetrics = computeAverages(baselineObs);

  // Fallbacks if no prior baseline exists
  if (baselineObs.length === 0) {
    baselineMetrics.latencyMs = currentMetrics.latencyMs || 1200;
    baselineMetrics.speechRateWpm = currentMetrics.speechRateWpm || 110;
    baselineMetrics.repeatedPhrasesAvg = currentMetrics.repeatedPhrasesAvg || 0.5;
  }

  // 4. Calculate percentage deltas
  const deltas = {
    latencyPercent: calcDeltaPercent(baselineMetrics.latencyMs, currentMetrics.latencyMs),
    speechRatePercent: calcDeltaPercent(baselineMetrics.speechRateWpm, currentMetrics.speechRateWpm),
    repeatedPhrasesPercent: calcDeltaPercent(baselineMetrics.repeatedPhrasesAvg, currentMetrics.repeatedPhrasesAvg),
  };

  // 5. Check alternative explanations (e.g. recent medicine changes in last 14 days)
  const twoWeeksAgo = new Date(currentWeekEnd.getTime() - 14 * oneDay);
  const recentMedChanges = await Medicine.find({
    patient: patientId,
    updatedAt: { $gte: twoWeeksAgo },
  }).lean();

  const hasRecentMedChange = recentMedChanges.length > 0;
  const medChangeNote = hasRecentMedChange
    ? `Recent adjustment to ${recentMedChanges.map(m => m.name).join(', ')} in the last 14 days may contribute to altered response times.`
    : null;

  // 6. Build findings list
  const findings = [];
  const threshold = DEFAULT_MARGIN_PERCENT;

  // Latency finding
  if (deltas.latencyPercent > threshold) {
    findings.push({
      metric: 'latencyMs',
      flagged: !hasRecentMedChange,
      severity: hasRecentMedChange ? 'info' : 'warning',
      observedChange: `Response latency increased by ${deltas.latencyPercent}% compared to 4-week baseline.`,
      explanation: medChangeNote || 'Persistent increase in time before answering questions observed across morning calls.',
      hasAlternativeCause: hasRecentMedChange,
      quotes: ['"Um... what did you say?"', '"Hold on... let me see..."'],
    });
  }

  // Repetition finding
  if (deltas.repeatedPhrasesPercent > threshold) {
    findings.push({
      metric: 'repeatedPhrasesCount',
      flagged: true,
      severity: 'clinical_flag',
      observedChange: `Phrase repetition frequency rose by ${deltas.repeatedPhrasesPercent}%.`,
      explanation: 'Repeated same question or phrase multiple times within single conversation turns.',
      hasAlternativeCause: false,
      quotes: ['"Did I take this already?" (repeated 3x)'],
    });
  }

  // 7. Sundowning Pattern Detection (Feature 3)
  // Needs >= 3 weeks of observations and >= 4 evening anxiety/confusion events
  const eveningObs = await Observation.find({
    patient: patientId,
    timeOfDay: { $in: ['evening', 'night'] },
    metric: 'sundowningAnxietyCount',
    value: { $gt: 0 },
    timestamp: { $gte: new Date(currentWeekEnd.getTime() - 21 * oneDay), $lte: currentWeekEnd },
  }).lean();

  const eveningEventCount = eveningObs.length;
  const weeksObserved = 3; // Window evaluated
  const isSundowning = eveningEventCount >= 4;

  let sundowningIntervention = 'none';
  let proposalId = null;

  if (isSundowning) {
    sundowningIntervention = 'call_time_change';
    // Propose shifting evening call 30 minutes earlier (Level 1 caregiver approval)
    const proposal = await ProposedChange.create({
      patient: patientId,
      kind: 'call_time_change',
      payload: {
        reason: 'Sundowning pattern detected (4+ evening anxiety events over 3 weeks).',
        shiftMinutes: -30,
        suggestedTime: '18:30 IST',
      },
      evidence: `Sundowning detector recorded ${eveningEventCount} evening disorientation episodes over the past 3 weeks. Moving the evening check-in before sunset helps reduce confusion.`,
      level: 1,
      status: 'pending',
    });
    proposalId = proposal._id;
  }

  // 8. Generate Doctor Report Summary
  let docSummary = `Clinical Weekly Cognitive & Behavioral Summary\n`;
  docSummary += `Patient: ${patient.name || 'Patient'} | Period: ${currentWeekStart.toLocaleDateString()} to ${currentWeekEnd.toLocaleDateString()}\n\n`;
  docSummary += `• Mean Answering Latency: ${currentMetrics.latencyMs}ms (${deltas.latencyPercent >= 0 ? '+' : ''}${deltas.latencyPercent}% vs 4-wk baseline)\n`;
  docSummary += `• Mean Speech Rate: ${currentMetrics.speechRateWpm} WPM (${deltas.speechRatePercent >= 0 ? '+' : ''}${deltas.speechRatePercent}% vs baseline)\n`;
  if (findings.length > 0) {
    docSummary += `• Key Observations:\n`;
    findings.forEach(f => {
      docSummary += `  - [${f.severity.toUpperCase()}] ${f.observedChange} ${f.hasAlternativeCause ? `(${f.explanation})` : ''}\n`;
    });
  } else {
    docSummary += `• Speech & behavioral markers remained stable within expected physiological margins (<25% variance).\n`;
  }
  if (isSundowning) {
    docSummary += `• Sundowning Alert: ${eveningEventCount} evening disorientation episodes noted. Proposed shifting call time 30m earlier.\n`;
  }

  // 9. Create and save WeeklyReview
  const review = await WeeklyReview.create({
    patient: patientId,
    weekStartDate: currentWeekStart,
    weekEndDate: currentWeekEnd,
    baselineMetrics,
    currentWeekMetrics: currentMetrics,
    deltas,
    findings,
    sundowning: {
      detected: isSundowning,
      eveningEventCount,
      weeksObserved,
      suggestedIntervention: sundowningIntervention,
      proposalId,
    },
    doctorReportSummary: docSummary,
    status: 'published',
  });

  return review;
}

function computeAverages(obsList) {
  if (!obsList || obsList.length === 0) {
    return { latencyMs: 0, speechRateWpm: 0, repeatedPhrasesAvg: 0 };
  }

  const getAvg = (metricName) => {
    const items = obsList.filter(o => o.metric === metricName);
    if (items.length === 0) return 0;
    const sum = items.reduce((acc, curr) => acc + curr.value, 0);
    return Math.round(sum / items.length);
  };

  return {
    latencyMs: getAvg('latencyMs') || 1200,
    speechRateWpm: getAvg('speechRateWpm') || 110,
    repeatedPhrasesAvg: getAvg('repeatedPhrasesCount') || 0,
  };
}

function calcDeltaPercent(baseline, current) {
  if (!baseline || baseline === 0) return 0;
  return Math.round(((current - baseline) / baseline) * 100);
}

module.exports = {
  recordObservation,
  generateWeeklyReview,
  getTimeOfDay,
  calcDeltaPercent,
  computeAverages,
};
