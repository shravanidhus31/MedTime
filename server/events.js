const EventEmitter = require('events');

/**
 * MedTime Global Event Bus — Contract C4
 *
 * Central event bus for cross-module coordination.
 * Subscribed to by:
 * - Refill alert system (B8)
 * - Daily Care Journal (B8)
 * - Adherence and escalation trackers
 *
 * Events:
 * - 'dose.taken':   { reminderId, reminder, medicineId, patientId, confirmedAt, source }
 * - 'dose.skipped': { reminderId, reminder, medicineId, patientId, confirmedAt, source }
 * - 'dose.missed':  { reminderId, reminder, medicineId, patientId, confirmedAt, source }
 * - 'refill.low':   { medicine, patientId, tabletCount, refillThreshold }
 */
class MedTimeEventEmitter extends EventEmitter {}

const eventBus = new MedTimeEventEmitter();

// Wire up Contract C4 listener for dose.taken
eventBus.on('dose.taken', async (payload) => {
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
        eventBus.emit('refill.low', {
          medicine: med,
          patientId: med.patient,
          tabletCount: med.tabletCount,
          refillThreshold: med.refillThreshold
        });
      }
    }
  } catch (err) {
    console.error('[EventBus] Error handling dose.taken:', err);
  }
});

module.exports = eventBus;
