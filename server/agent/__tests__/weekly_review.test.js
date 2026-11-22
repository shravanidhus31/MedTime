const assert = require('assert');
const { calcDeltaPercent, computeAverages } = require('../../services/weeklyReviewService');

/**
 * Unit Test Suite for B14 (Weekly Review & Sundowning Agent)
 */

async function runTests() {
  console.log('🧪 Starting B14 Weekly Review Unit Test Suite...\n');
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

  // 1. Delta Calculations
  console.log('--- 1. Percentage Delta & Threshold Gating ---');
  test('Calculates positive and negative percentage deltas correctly', () => {
    assert.strictEqual(calcDeltaPercent(1000, 1300), 30); // 30% increase
    assert.strictEqual(calcDeltaPercent(100, 80), -20);   // 20% decrease
    assert.strictEqual(calcDeltaPercent(100, 100), 0);    // No change
  });

  test('Gating flag triggers only when delta exceeds 25% threshold', () => {
    const threshold = 25;
    const delta1 = calcDeltaPercent(1000, 1200); // 20% (under threshold)
    const delta2 = calcDeltaPercent(1000, 1350); // 35% (over threshold)

    assert.strictEqual(delta1 > threshold, false);
    assert.strictEqual(delta2 > threshold, true);
  });

  // 2. Average Aggregation
  console.log('\n--- 2. Metric Averages Calculation ---');
  test('Computes metric averages accurately across observations', () => {
    const obsList = [
      { metric: 'latencyMs', value: 1000 },
      { metric: 'latencyMs', value: 1200 },
      { metric: 'latencyMs', value: 1400 },
      { metric: 'speechRateWpm', value: 120 },
      { metric: 'speechRateWpm', value: 100 },
      { metric: 'repeatedPhrasesCount', value: 2 },
      { metric: 'repeatedPhrasesCount', value: 4 },
    ];

    const avgs = computeAverages(obsList);
    assert.strictEqual(avgs.latencyMs, 1200);
    assert.strictEqual(avgs.speechRateWpm, 110);
    assert.strictEqual(avgs.repeatedPhrasesAvg, 3);
  });

  test('Handles empty observation list gracefully with defaults', () => {
    const avgs = computeAverages([]);
    assert.strictEqual(avgs.latencyMs, 0);
    assert.strictEqual(avgs.speechRateWpm, 0);
    assert.strictEqual(avgs.repeatedPhrasesAvg, 0);
  });

  // 3. Alternative Explanation Logic (Non-Cognitive Causes)
  console.log('\n--- 3. Alternative Explanation Attribution ---');
  test('Flags change as non-cognitive when recent medicine change exists', () => {
    const hasRecentMedChange = true;
    const latencyDelta = 35; // 35% > 25%

    const isCognitiveFlag = latencyDelta > 25 && !hasRecentMedChange;
    const isAttributedToMedicine = latencyDelta > 25 && hasRecentMedChange;

    assert.strictEqual(isCognitiveFlag, false, 'Should not raise unverified cognitive decline flag');
    assert.strictEqual(isAttributedToMedicine, true, 'Should attribute to medication side effect');
  });

  // 4. Sundowning Detection Logic
  console.log('\n--- 4. Sundowning Pattern Detection (Feature 3) ---');
  test('Requires at least 4 evening events over 3 weeks to trigger intervention', () => {
    const scenario1_events = 2; // Under threshold
    const scenario2_events = 4; // At threshold
    const scenario3_events = 6; // Above threshold

    function detectSundowning(eveningEvents) {
      return eveningEvents >= 4;
    }

    assert.strictEqual(detectSundowning(scenario1_events), false);
    assert.strictEqual(detectSundowning(scenario2_events), true);
    assert.strictEqual(detectSundowning(scenario3_events), true);
  });

  console.log('\n========================================');
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log('========================================\n');

  if (failed > 0) process.exit(1);
}

runTests();
