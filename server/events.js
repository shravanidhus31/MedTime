// App-wide event bus (contract C4). One shared Node EventEmitter.
//
//   const events = require('./events');
//   events.on('dose.taken', ({ reminderId, medicineId, patientId, status, source, at }) => { ... });
//
// Events emitted by services/doseService.js: 'dose.taken', 'dose.skipped', 'dose.missed'.
// Listeners must not throw; a failing listener is logged and ignored.

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

module.exports = new AppEvents();
