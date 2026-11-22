import React, { useState, useEffect } from 'react';
import api from '../../utils/api';

/**
 * RoutineProfileEditor — B12 (Feature 8: Prescription-to-Schedule Agent)
 *
 * Allows caregivers to define a patient's daily routine:
 *   • Wake-up, breakfast, lunch, dinner, and bedtime in IST (HH:mm)
 *   • Pillbox slot labels (A–F, A4, 7-day, custom)
 *   • Weekend override times
 *
 * The backend stores this as a RoutineProfile document.
 * The readPrescription tool uses it to fit new medicines into the schedule.
 */

const DEFAULT_PROFILE = {
  wakeUpTime: '07:00',
  breakfastTime: '08:00',
  lunchTime: '13:00',
  dinnerTime: '20:00',
  bedTime: '22:00',
  pillboxSlots: ['A', 'B', 'C', 'D', 'E', 'F'],
  weekendWakeUpTime: '',
  weekendBreakfastTime: '',
  weekendBedTime: '',
  notes: '',
};

const PILLBOX_PRESETS = {
  'A–F (Standard 6-slot)': ['A', 'B', 'C', 'D', 'E', 'F'],
  'A4 (4-slot)': ['A', 'B', 'C', 'D'],
  '7-Day (AM/PM)': ['Mon-AM','Mon-PM','Tue-AM','Tue-PM','Wed-AM','Wed-PM','Thu-AM','Thu-PM','Fri-AM','Fri-PM','Sat-AM','Sat-PM','Sun-AM','Sun-PM'],
  'Custom': [],
};

export default function RoutineProfileEditor({ patientId }) {
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success'|'error', text }
  const [pillboxPreset, setPillboxPreset] = useState('A–F (Standard 6-slot)');
  const [customSlots, setCustomSlots] = useState('');

  useEffect(() => {
    if (!patientId) return;
    setLoading(true);
    api.get(`/voice/routine/${patientId}`)
      .then(res => {
        if (res.data?.profile) {
          setProfile(prev => ({ ...DEFAULT_PROFILE, ...res.data.profile }));
          // Detect preset from slots
          const slots = res.data.profile.pillboxSlots || [];
          const match = Object.entries(PILLBOX_PRESETS).find(
            ([, v]) => JSON.stringify(v) === JSON.stringify(slots)
          );
          if (match) {
            setPillboxPreset(match[0]);
          } else if (slots.length) {
            setPillboxPreset('Custom');
            setCustomSlots(slots.join(', '));
          }
        }
      })
      .catch(() => {/* no existing profile is fine */})
      .finally(() => setLoading(false));
  }, [patientId]);

  const handleChange = (field, value) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  const handlePillboxPreset = (preset) => {
    setPillboxPreset(preset);
    if (preset !== 'Custom') {
      setProfile(prev => ({ ...prev, pillboxSlots: PILLBOX_PRESETS[preset] }));
    } else {
      setProfile(prev => ({ ...prev, pillboxSlots: [] }));
    }
  };

  const handleCustomSlots = (val) => {
    setCustomSlots(val);
    const slots = val.split(',').map(s => s.trim()).filter(Boolean);
    setProfile(prev => ({ ...prev, pillboxSlots: slots }));
  };

  const handleSave = async () => {
    if (!patientId) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.post(`/voice/routine/${patientId}`, profile);
      setMessage({ type: 'success', text: 'Routine profile saved successfully.' });
    } catch (err) {
      setMessage({ type: 'error', text: err?.response?.data?.error || 'Failed to save profile.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-[#e8dcc8] p-6">
        <p className="text-sm text-[#8a7560] animate-pulse">Loading routine profile…</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e8dcc8] p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#2d2418]">📅 Daily Routine Profile</h2>
        <span className="text-xs text-[#8a7560] bg-[#fdf8f0] px-3 py-1 rounded-full">
          Used by Prescription Agent to fit new medicines into the schedule
        </span>
      </div>

      {/* Meal & Sleep Times */}
      <div>
        <h3 className="text-sm font-semibold text-[#5c4535] mb-3">Weekday Times (IST)</h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {[
            { label: '☀️ Wake Up', field: 'wakeUpTime' },
            { label: '🍳 Breakfast', field: 'breakfastTime' },
            { label: '🍛 Lunch', field: 'lunchTime' },
            { label: '🌙 Dinner', field: 'dinnerTime' },
            { label: '🛏 Bedtime', field: 'bedTime' },
          ].map(({ label, field }) => (
            <div key={field}>
              <label className="block text-xs text-[#8a7560] mb-1">{label}</label>
              <input
                type="time"
                value={profile[field]}
                onChange={e => handleChange(field, e.target.value)}
                className="w-full border border-[#e8dcc8] rounded-lg px-3 py-2 text-sm text-[#2d2418] focus:outline-none focus:ring-2 focus:ring-[#c5a87a]"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Weekend Overrides */}
      <div>
        <h3 className="text-sm font-semibold text-[#5c4535] mb-1">Weekend Overrides (optional)</h3>
        <p className="text-xs text-[#8a7560] mb-3">Leave blank to use the same weekday times on weekends.</p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {[
            { label: '☀️ Weekend Wake Up', field: 'weekendWakeUpTime' },
            { label: '🍳 Weekend Breakfast', field: 'weekendBreakfastTime' },
            { label: '🛏 Weekend Bedtime', field: 'weekendBedTime' },
          ].map(({ label, field }) => (
            <div key={field}>
              <label className="block text-xs text-[#8a7560] mb-1">{label}</label>
              <input
                type="time"
                value={profile[field]}
                onChange={e => handleChange(field, e.target.value)}
                className="w-full border border-[#e8dcc8] rounded-lg px-3 py-2 text-sm text-[#2d2418] focus:outline-none focus:ring-2 focus:ring-[#c5a87a]"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Pillbox Layout */}
      <div>
        <h3 className="text-sm font-semibold text-[#5c4535] mb-3">Pillbox Layout</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {Object.keys(PILLBOX_PRESETS).map(preset => (
            <button
              key={preset}
              onClick={() => handlePillboxPreset(preset)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                pillboxPreset === preset
                  ? 'bg-[#5c4535] text-white border-[#5c4535]'
                  : 'bg-white text-[#5c4535] border-[#c8b89a] hover:bg-[#fdf8f0]'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>

        {pillboxPreset === 'Custom' && (
          <div>
            <label className="block text-xs text-[#8a7560] mb-1">Custom Slot Labels (comma-separated)</label>
            <input
              type="text"
              placeholder="e.g. Morning, Noon, Night"
              value={customSlots}
              onChange={e => handleCustomSlots(e.target.value)}
              className="w-full border border-[#e8dcc8] rounded-lg px-3 py-2 text-sm text-[#2d2418] focus:outline-none focus:ring-2 focus:ring-[#c5a87a]"
            />
          </div>
        )}

        {profile.pillboxSlots.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {profile.pillboxSlots.map(slot => (
              <span key={slot} className="bg-[#fdf8f0] border border-[#e8dcc8] text-[#5c4535] text-xs px-3 py-1 rounded-full font-semibold">
                {slot}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-[#8a7560] mb-1">Notes for Agent</label>
        <textarea
          rows={2}
          placeholder="e.g. Patient skips lunch on Tuesdays. Blood pressure medicine must always be morning."
          value={profile.notes}
          onChange={e => handleChange('notes', e.target.value)}
          className="w-full border border-[#e8dcc8] rounded-lg px-3 py-2 text-sm text-[#2d2418] focus:outline-none focus:ring-2 focus:ring-[#c5a87a] resize-none"
        />
      </div>

      {/* Save & Message */}
      {message && (
        <div className={`text-sm px-4 py-2 rounded-lg ${
          message.type === 'success'
            ? 'bg-[#c8d9c4] text-[#2a4a28]'
            : 'bg-[#f7ddd4] text-[#7a2a1a]'
        }`}>
          {message.text}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !patientId}
        className="w-full bg-[#5c4535] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#4a3628] disabled:opacity-50 transition-colors"
      >
        {saving ? 'Saving…' : 'Save Routine Profile'}
      </button>
    </div>
  );
}
