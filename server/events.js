// App-wide event bus (contract C4). One shared Node EventEmitter.
//
//   const events = require('./events');
//   events.on('dose.taken', ({ reminderId, medicineId, patientId, status, source, at }) => { ... });
//
// Events:
// - 'dose.taken' | 'dose.skipped' | 'dose.missed': emitted by services/doseService.js (Person A),
//   payload { reminderId, medicineId, patientId, status, source, at }. A dose is recorded as taken
//   at most once, so 'dose.taken' fires once per dose.
// - 'refill.low': emitted below (Person B, B8), payload { medicine, patientId, tabletCount, refillThreshold }.
//
// Listeners must not throw; a failing listener (sync or async) is logged and ignored, so a
// listener problem can never stop a dose from being recorded.

const { EventEmitter } = require('events');

class AppEvents extends EventEmitter {
  emit(name, ...args) {
    for (const listener of this.listeners(name)) {
      try {
        const out = listener(...args);
        if (out && typeof out.catch === 'function') {
          out.catch((err) => console.error(`[events] async listener for "${name}" failed:`, err.message));
        }
      } catch (err) {
        console.error(`[events] listener for "${name}" failed:`, err.message);
      }
    }
    return this.listenerCount(name) > 0;
  }
}

const events = new AppEvents();

// ─── Refill tracking (Person B, B8, FR6) ──────────────────────────────────────
// On each dose taken: count one tablet down, and emit 'refill.low' at the threshold.
events.on('dose.taken', async (payload) => {
  try {
    const Medicine = require('./models/Medicine');
    const medId = payload.medicineId || (payload.reminder && (payload.reminder.medicine || payload.reminder.medication));
    if (!medId) return;

    const med = await Medicine.findById(medId);
    if (!med) return;

    // Decrement tabletCount by 1 (or dose quantity, default 1)
    if (typeof med.tabletCount === 'number' && med.tabletCount > 0) {
      med.tabletCount = Math.max(0, med.tabletCount - 1);
      await med.save();
      console.log(`[EventBus] dose.taken: decremented tabletCount for ${med.name} to ${med.tabletCount}`);

      // Check refill threshold (FR6)
      if (typeof med.refillThreshold === 'number' && med.tabletCount <= med.refillThreshold) {
        console.warn(`[EventBus] REFILL ALERT: ${med.name} stock (${med.tabletCount}) is at or below threshold (${med.refillThreshold})`);
        events.emit('refill.low', {
          medicine: med,
          patientId: med.patient,
          tabletCount: med.tabletCount,
          refillThreshold: med.refillThreshold,
        });
      }
    }
  } catch (err) {
    console.error('[EventBus] Error handling dose.taken:', err);
  }
});

module.exports = events;
