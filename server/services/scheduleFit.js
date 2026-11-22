// Fitting medicines to the patient's day, and checking food rules against her meals (Feature 8, B12;
// moved out of routes/ocrRoutes.js and extended in the 22 Nov review).
//
//   fitToRoutine(medicines, routine) → medicines with scheduledTimes and timingConflicts
//   foodTimingConflicts({ name, foodRule, scheduledTimes }, routine) → [{ time, message, suggestion }]
//
// The plan (B12, CHI 2025): flag conflicts and explain them, then let the caregiver decide, e.g.
// "with food" at a time with no meal, or "before breakfast" moved to after lunch. Before, every
// fitted time was marked valid and a missing meal was silently replaced by a default, so no food
// conflict could ever be reported.

const DEFAULT_DAY = { wake: '07:00', breakfast: '08:00', lunch: '13:00', dinner: '20:00', bed: '22:00' };
const MEALS = ['breakfast', 'lunch', 'dinner'];
const PERIOD_MEAL = { morning: 'breakfast', afternoon: 'lunch', evening: 'dinner' };
const PERIOD_DEFAULT = { morning: '08:00', afternoon: '13:00', evening: '19:00', night: '21:00' };

const toMin = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const toHHMM = (min) => {
  const x = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
const addMinutes = (t, n) => (toMin(t) === null ? t : toHHMM(toMin(t) + n));
const spoken = (t) => {
  const m = toMin(t);
  if (m === null) return t;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// Her meal times (only the meals she has), from the weekday routine, or the defaults with no profile.
function mealsOf(routine) {
  if (!routine) return { ...DEFAULT_DAY };
  const day = routine.weekday || {};
  const out = {};
  for (const k of [...MEALS, 'wake', 'bed']) if (toMin(day[k]) !== null) out[k] = day[k];
  return out;
}

// Does this food rule fit this time, given her meals? Windows: "with" within 30 min of a meal;
// "before" 0–60 min before one; "after" 0–90 min after one.
function fits(foodRule, minute, meals) {
  const ms = MEALS.filter((k) => meals[k]).map((k) => ({ k, at: toMin(meals[k]) }));
  if (foodRule === 'with') return ms.some((m) => Math.abs(minute - m.at) <= 30);
  if (foodRule === 'before') return ms.some((m) => m.at - minute >= 0 && m.at - minute <= 60);
  if (foodRule === 'after') return ms.some((m) => minute - m.at >= 0 && minute - m.at <= 90);
  return true;
}

const RULE_WORDS = { with: 'with food', before: 'before food', after: 'after food' };

// Warnings for a medicine whose food rule doesn't fit her meals at its times.
function foodTimingConflicts(med, routine) {
  const rule = med.foodRule || med.mealTiming;
  if (!RULE_WORDS[rule]) return [];
  const meals = mealsOf(routine);
  const mealList = MEALS.filter((k) => meals[k]);
  const out = [];
  for (const t of med.scheduledTimes || []) {
    const minute = toMin(t);
    if (minute === null || fits(rule, minute, meals)) continue;
    if (!mealList.length) {
      out.push({ time: t, message: `${med.name} is to be taken ${RULE_WORDS[rule]}, but her routine has no meal times.`, suggestion: null });
      continue;
    }
    // the nearest meal, and the time that would fit it
    const nearest = mealList.map((k) => ({ k, at: toMin(meals[k]) })).sort((a, b) => Math.abs(a.at - minute) - Math.abs(b.at - minute))[0];
    const suggestion = rule === 'before' ? addMinutes(meals[nearest.k], -15) : rule === 'after' ? addMinutes(meals[nearest.k], 30) : meals[nearest.k];
    out.push({
      time: t,
      message: `${med.name} is to be taken ${RULE_WORDS[rule]}, but ${spoken(t)} isn't ${rule === 'with' ? 'at' : rule} a meal (her ${nearest.k} is at ${spoken(meals[nearest.k])}). Suggest ${spoken(suggestion)}?`,
      suggestion,
    });
  }
  return out;
}

// One time for a period: explicit on the prescription, else from her meal for that period and the
// food rule. A meal she doesn't have is not invented: the default time is used and the check flags it.
function periodTime(foodRule, meals, period) {
  const meal = meals[PERIOD_MEAL[period]];
  if (!meal || !RULE_WORDS[foodRule]) return PERIOD_DEFAULT[period] || '08:00';
  if (foodRule === 'before') return addMinutes(meal, -15);
  if (foodRule === 'after') return addMinutes(meal, 30);
  return meal;
}

function fitToRoutine(medicines, routine) {
  const meals = mealsOf(routine);
  return medicines.map((med) => {
    if (!med.name) return { ...med, scheduledTimes: null, conflict: 'no_name' };
    // Times written on the prescription ("8 am and 4 pm", "at bedtime") win over our defaults.
    let times = (med.times || []).filter((t) => toMin(t) !== null);
    if (!times.length) {
      const periods = { once: ['morning'], twice: ['morning', 'evening'], thrice: ['morning', 'afternoon', 'evening'] }[med.frequency] || ['morning'];
      times = periods.map((p) => periodTime(med.foodRule, meals, p));
    }
    const timingConflicts = foodTimingConflicts({ name: med.name, foodRule: med.foodRule, scheduledTimes: times }, routine);
    return { ...med, scheduledTimes: times, timingConflicts: timingConflicts.length ? timingConflicts : null };
  });
}

module.exports = { fitToRoutine, foodTimingConflicts, mealsOf, addMinutes, toMin };
