/**
 * Safety Screen Tests — B5 (Contract C9)
 *
 * Verifies:
 * 1. Unit tests for every keyword category in all 3 languages (EN, HI, MR).
 * 2. 50 hand-written tricky cases covering conversational variations, scam signals,
 *    subtle emergencies, and safe everyday remarks (negative controls).
 */

const assert = require('assert');
const { screen, checkKeywords, redFlags } = require('../screen');

async function runTests() {
  console.log('🧪 Starting Safety Screen Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function testCase(desc, fn) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${desc}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${desc}:`, err.message);
    }
  }

  async function testCaseAsync(desc, fn) {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${desc}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${desc}:`, err.message);
    }
  }

  // ─── 1. Category Unit Tests (All 3 languages for every category) ───────────
  console.log('--- 1. Category Unit Tests in 3 Languages ---');
  const categories = Object.keys(redFlags);

  for (const cat of categories) {
    for (const lang of ['en', 'hi', 'mr']) {
      const sampleWord = redFlags[cat].keywords[lang][0];
      testCase(`Category "${cat}" detected for ${lang.toUpperCase()}: "${sampleWord}"`, () => {
        const res = checkKeywords(`Oh dear, ${sampleWord} right now`);
        assert.ok(res, `Expected match for "${sampleWord}" in category ${cat}`);
        assert.strictEqual(res.category, cat);
      });
    }
  }

  // ─── 2. 50 Hand-Written Tricky & Edge Cases ──────────────────────────────
  console.log('\n--- 2. 50 Tricky Edge Cases & Controls ---');

  const trickyCases = [
    // Sudden Confusion / Stroke signs (1-7)
    { text: "My leg won't move this morning", expected: 'sudden_confusion' },
    { text: "My arm won't move when I try to lift it", expected: 'sudden_confusion' },
    { text: "I cannot move my leg at all", expected: 'sudden_confusion' },
    { text: "Everything is spinning and I cannot see", expected: 'sudden_confusion' },
    { text: "Who are you and what is this place", expected: 'sudden_confusion' },
    { text: "Where am I, this is not my room", expected: 'sudden_confusion' },
    { text: "My face feels numb and drooping", expected: 'sudden_confusion' },

    // Financial Scam / Cognitive Decline Override (8-14)
    { text: "My nephew called and needs my bank PIN", expected: 'financial_scam' },
    { text: "Someone called asking for OTP to verify my card", expected: 'financial_scam' },
    { text: "A caller told me to send money to collect my parcel", expected: 'financial_scam' },
    { text: "They need my bank account number to deposit winnings", expected: 'financial_scam' },
    { text: "Should I give password to the computer repairman?", expected: 'financial_scam' },
    { text: "Khate mein paise bhejne ke liye bol rahe hain", expected: 'financial_scam' },
    { text: "Bank khate madhe paise pathva sangitle ahe", expected: 'financial_scam' },

    // Fall & Physical Collapses (15-21)
    { text: "I tripped on the rug and fell", expected: 'fall' },
    { text: "I slipped on floor while going to the bathroom", expected: 'fall' },
    { text: "I am lying on the floor and can't stand up", expected: 'fall' },
    { text: "I fell down the steps and hurt my back", expected: 'fall' },
    { text: "Bathroom madhe ghasarlo aani khaley padlo", expected: 'fall' },
    { text: "Subah phisal gaya zameen par pada hoon", expected: 'fall' },
    { text: "Can't get up off the kitchen ground", expected: 'fall' },

    // Chest Pain & Cardiac (22-28)
    { text: "My chest hurts whenever I try to bend over", expected: 'chest_pain' },
    { text: "There is intense pressure in chest right now", expected: 'chest_pain' },
    { text: "Seene mein dard ho raha hai bahut zor se", expected: 'chest_pain' },
    { text: "Chatit dukhtay aani ghabrayla hot ahe", expected: 'chest_pain' },
    { text: "Feels like a crushing pain in chest", expected: 'chest_pain' },
    { text: "I think I am having a heart attack", expected: 'chest_pain' },
    { text: "Heavy chest and left shoulder aching", expected: 'chest_pain' },

    // Breathlessness & Respiratory (29-35)
    { text: "I cannot breathe when I lie flat", expected: 'breathlessness' },
    { text: "Gasping for air after taking two steps", expected: 'breathlessness' },
    { text: "Feeling like I am suffocating right now", expected: 'breathlessness' },
    { text: "Saans nahi aa rahi bahut ghutan ho rahi", expected: 'breathlessness' },
    { text: "Shwas gheta yet nahi tras hoto ahe", expected: 'breathlessness' },
    { text: "Short of breath since this afternoon", expected: 'breathlessness' },
    { text: "Hard to breathe through my nose and mouth", expected: 'breathlessness' },

    // Extra Pills & Overdose (36-42)
    { text: "I accidentally took extra pills because I forgot", expected: 'extra_pills' },
    { text: "I took two doses an hour ago by mistake", expected: 'extra_pills' },
    { text: "I took wrong medicine from the other bottle", expected: 'extra_pills' },
    { text: "Drank whole syrup bottle instead of one spoon", expected: 'extra_pills' },
    { text: "Accidentally swallowed all pills from the box", expected: 'extra_pills' },
    { text: "Galti se do baar dawai li subah", expected: 'extra_pills' },
    { text: "Chukicha aushadh ghetla me", expected: 'extra_pills' },

    // Self Harm & Crisis (43-46)
    { text: "I feel so helpless that I want to die", expected: 'self_harm' },
    { text: "I would be better off dead than living like this", expected: 'self_harm' },
    { text: "Aise dard mein jeena nahi chahta", expected: 'self_harm' },
    { text: "Mala maraycha ahe tras sahan hot nahi", expected: 'self_harm' },

    // Safe Everyday Remarks / Negative Controls (47-50) — Must be 'ok'!
    { text: "Good morning, I had tea and toast today", expected: null },
    { text: "My knee feels slightly stiff from yesterday's walk", expected: null },
    { text: "I took my morning white pill with water already", expected: null },
    { text: "Priya said she will visit this Saturday evening", expected: null },
  ];

  for (let i = 0; i < trickyCases.length; i++) {
    const { text, expected } = trickyCases[i];
    await testCaseAsync(
      `Tricky Case #${i + 1} (${expected || 'SAFE'}): "${text.substring(0, 45)}..."`,
      async () => {
        const res = await screen(text, { isFinal: false });
        if (expected === null) {
          assert.strictEqual(res.verdict, 'ok', `Expected 'ok' verdict for safe text`);
        } else {
          assert.strictEqual(res.verdict, 'redflag', `Expected redflag for "${text}"`);
          assert.strictEqual(res.category, expected, `Expected category "${expected}" but got "${res.category}"`);
        }
      }
    );
  }

  console.log(`\n========================================`);
  console.log(`Results: ${passed} passed, ${failed} failed.`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
