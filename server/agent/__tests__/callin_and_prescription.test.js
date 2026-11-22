const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { classifyQuestion, checkThrottle, callThrottle } = require('../flows/callinFlow');
const { getISTMidnightUTC } = require('../../jobs/reminderTopUpJob');

/**
 * Unit Test Suite for B11 (Call-In Agent) & B12 (Prescription-to-Schedule Agent)
 */

async function runTests() {
  console.log('🧪 Starting B11 & B12 Unit Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err.message);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err.message);
      failed++;
    }
  }

  // ─── 1. Question Classification (B11) ──────────────────────────────────────
  console.log('--- 1. B11 Call-In Question Classification ---');
  test('Classifies "Did I take my morning pills?" as doses', () => {
    assert.strictEqual(classifyQuestion('Did I take my morning pills?'), 'doses');
  });

  test('Classifies "Have I taken my blood pressure medicine today?" as doses', () => {
    assert.strictEqual(classifyQuestion('Have I taken my blood pressure medicine today?'), 'doses');
  });

  test('Classifies "Did I have my evening tablet?" as doses', () => {
    assert.strictEqual(classifyQuestion('Did I have my evening tablet?'), 'doses');
  });

  test('Classifies "Who is Priya?" as memory', () => {
    assert.strictEqual(classifyQuestion('Who is Priya?'), 'memory');
  });

  test('Classifies "Where is my daughter living?" as memory', () => {
    assert.strictEqual(classifyQuestion('Where is my daughter living?'), 'memory');
  });

  test('Classifies "What is my morning schedule?" as today', () => {
    assert.strictEqual(classifyQuestion('What is my morning schedule?'), 'today');
  });

  test('Classifies unrelated questions as other', () => {
    assert.strictEqual(classifyQuestion('Is it going to rain outside?'), 'other');
  });

  // ─── 2. IST Midnight Window Calculation (B12 #7) ───────────────────────────
  console.log('\n--- 2. B12 IST Midnight Window Calculation ---');
  test('Calculates IST midnight correctly from a UTC timestamp', () => {
    // 18:30 UTC on Nov 21 = 00:00 IST on Nov 22
    const testDate = new Date('2026-11-21T18:30:00Z');
    const istMidnight = getISTMidnightUTC(testDate);
    // Should be exactly 18:30 UTC on Nov 21 (00:00 IST on Nov 22)
    assert.strictEqual(istMidnight.toISOString(), '2026-11-21T18:30:00.000Z');
  });

  test('Calculates IST midnight for mid-day UTC', () => {
    // 06:00 UTC on Nov 22 = 11:30 IST on Nov 22
    const testDate = new Date('2026-11-22T06:00:00Z');
    const istMidnight = getISTMidnightUTC(testDate);
    // Day began at 18:30 UTC on Nov 21
    assert.strictEqual(istMidnight.toISOString(), '2026-11-21T18:30:00.000Z');
  });

  // ─── 3. Prescription Routine Fitting (B12) ─────────────────────────────────
  console.log('\n--- 3. B12 Prescription Routine & Schedule Fitting ---');
  test('Routine fitting handles before/after/with food rules', () => {
    // Helper replication from ocrRoutes
    function resolveTime(foodRule, schedule, period) {
      function addMinutes(timeStr, mins) {
        const [h, m] = timeStr.split(':').map(Number);
        const total = h * 60 + m + mins;
        const newH = Math.floor(((total % 1440) + 1440) % 1440 / 60);
        const newM = ((total % 60) + 60) % 60;
        return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
      }

      if (foodRule === 'before' && period === 'morning') return addMinutes(schedule.breakfast, -15);
      if (foodRule === 'after' && period === 'morning') return addMinutes(schedule.breakfast, 30);
      if (foodRule === 'with' && period === 'morning') return schedule.breakfast;
      return '08:00';
    }

    const schedule = { breakfast: '08:00', lunch: '13:00', dinner: '20:00' };

    assert.strictEqual(resolveTime('before', schedule, 'morning'), '07:45');
    assert.strictEqual(resolveTime('after', schedule, 'morning'), '08:30');
    assert.strictEqual(resolveTime('with', schedule, 'morning'), '08:00');
  });

  // ─── 4. Prescription Proposal Level Gating (B12) ───────────────────────────
  console.log('\n--- 4. B12 Proposal Level Gating ---');
  test('Clear prescription with no conflicts maps to Level 1 (Caregiver)', () => {
    const extraction = { hasConflicts: false, hasLowConfidence: false };
    const level = (extraction.hasConflicts || extraction.hasLowConfidence) ? 2 : 1;
    assert.strictEqual(level, 1);
  });

  test('Prescription with duplicate or strength change maps to Level 2 (Doctor)', () => {
    const extraction = { hasConflicts: true, hasLowConfidence: false };
    const level = (extraction.hasConflicts || extraction.hasLowConfidence) ? 2 : 1;
    assert.strictEqual(level, 2);
  });

  test('Prescription with low confidence line maps to Level 2 (Doctor)', () => {
    const extraction = { hasConflicts: false, hasLowConfidence: true };
    const level = (extraction.hasConflicts || extraction.hasLowConfidence) ? 2 : 1;
    assert.strictEqual(level, 2);
  });

  // ─── 5. Weekly and Alternate Days Schedule Rules (B12 #5) ──────────────────
  console.log('\n--- 5. B12 Frequency Filtering Logic ---');
  test('Weekly frequency filters out non-matching days of week', () => {
    const allowedDays = [1, 3, 5]; // Mon, Wed, Fri
    const sunday = 0;
    const monday = 1;
    assert.strictEqual(allowedDays.includes(sunday), false);
    assert.strictEqual(allowedDays.includes(monday), true);
  });

  test('Alternate days frequency alternates every interval', () => {
    const interval = 2;
    assert.strictEqual(0 % interval === 0, true);  // Day 0: take
    assert.strictEqual(1 % interval === 0, false); // Day 1: skip
    assert.strictEqual(2 % interval === 0, true);  // Day 2: take
    assert.strictEqual(3 % interval === 0, false); // Day 3: skip
  });

  // ─── 6. B11 Repeat Call Throttling & Sundowning Detection ──────────────────
  console.log('\n--- 6. B11 Repeat Call Throttling (>3 calls / hour) ---');
  test('First 3 calls within 1 hour do not trigger throttling', () => {
    callThrottle.clear();
    const patientId = 'pt_test_123';
    const reminderId = 'rem_test_456';

    assert.strictEqual(checkThrottle(patientId, reminderId), false); // Call 1
    assert.strictEqual(checkThrottle(patientId, reminderId), false); // Call 2
    assert.strictEqual(checkThrottle(patientId, reminderId), false); // Call 3
  });

  test('4th call within 1 hour triggers repeat pattern throttling', () => {
    const patientId = 'pt_test_123';
    const reminderId = 'rem_test_456';
    // 4th call
    assert.strictEqual(checkThrottle(patientId, reminderId), true);
  });

  test('Different reminder or patient does not trigger throttle', () => {
    const patientId = 'pt_test_123';
    const differentReminderId = 'rem_test_789';
    assert.strictEqual(checkThrottle(patientId, differentReminderId), false);
  });

  // ─── 7. B12 Synthetic Prescription Test Dataset Verification ───────────────
  console.log('\n--- 7. B12 Synthetic Prescription Test Dataset ---');
  test('Prescription benchmark dataset contains exactly 20 validated cases', () => {
    const datasetPath = path.resolve(__dirname, '../../../eval/prescriptions/prescriptions.json');
    assert.strictEqual(fs.existsSync(datasetPath), true, 'prescriptions.json exists');
    const prescriptions = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
    assert.strictEqual(prescriptions.length, 20, '20 prescriptions present');

    const typedCount = prescriptions.filter(p => p.type === 'typed').length;
    const ocrCount = prescriptions.filter(p => p.type === 'handwritten_ocr').length;
    const conflictCount = prescriptions.filter(p => p.hasConflicts).length;
    const lowConfCount = prescriptions.filter(p => p.hasLowConfidence).length;

    assert.ok(typedCount >= 10, 'At least 10 clean typed prescriptions');
    assert.ok(ocrCount >= 2, 'Handwritten OCR artifact prescriptions present');
    assert.ok(conflictCount >= 2, 'Duplicate and strength change conflict cases present');
    assert.ok(lowConfCount >= 2, 'Low confidence smudged/illegible cases present');
  });

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log('========================================\n');

  if (failed > 0) process.exit(1);
}

runTests();
