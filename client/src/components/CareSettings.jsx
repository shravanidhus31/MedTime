import React, { useEffect, useState } from 'react';
import api from '../utils/api';

/**
 * CareSettings — how MedTime phones the patient (A3.5).
 *  - Talking assistant (dementia mode): dose calls are a spoken conversation with the agent
 *    (it checks the dose log, asks which tablet, calls again, tells the family). Off: the
 *    keypad menu ("press 1 if you have taken it").
 *  - Language the assistant speaks and listens in.
 * patientId: for a caregiver (primary access); the patient leaves it out.
 */
export default function CareSettings({ patientId }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const query = patientId ? `?patientId=${patientId}` : '';

  useEffect(() => {
    let live = true;
    api.get(`/users/care-settings${query}`)
      .then((res) => { if (live) setSettings(res.data); })
      .catch((err) => { if (live) setMsg({ type: 'error', text: err?.response?.data?.message || 'Could not load call settings.' }); });
    return () => { live = false; };
  }, [query]);

  const save = async (change) => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await api.put('/users/care-settings', { ...(patientId ? { patientId } : {}), ...change });
      setSettings(res.data);
      setMsg({ type: 'success', text: 'Saved.' });
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.message || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#e8dcc8] p-6 space-y-4">
      <h2 className="text-lg font-bold text-[#2d2418]">📞 How MedTime calls</h2>
      {!settings ? (
        <p className="text-sm text-[#8a7560]">{msg ? msg.text : 'Loading…'}</p>
      ) : (
        <>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-[#5c4535]"
              checked={settings.dementiaMode}
              disabled={saving}
              onChange={(e) => save({ dementiaMode: e.target.checked })}
            />
            <span>
              <span className="block text-sm font-semibold text-[#2d2418]">Talking assistant (dementia mode)</span>
              <span className="block text-xs text-[#8a7560]">
                Dose calls become a spoken conversation: the assistant checks the dose log, asks which tablet was taken,
                calls again if there is no answer, and tells the family when it can't confirm. Off: a keypad menu.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-[#5c4535]"
              checked={!!settings.guidedSteps}
              disabled={saving}
              onChange={(e) => save({ guidedSteps: e.target.checked })}
            />
            <span>
              <span className="block text-sm font-semibold text-[#2d2418]">Step-by-step guidance</span>
              <span className="block text-xs text-[#8a7560]">
                Dose calls walk her through it one step at a time: where the medicines are, the pillbox, food if needed, water,
                swallowing. A simpler hint if she gets stuck; if she is stuck twice, the family is called. Calls take a little longer.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5 accent-[#5c4535]"
              checked={!!settings.weeklyChat}
              disabled={saving}
              onChange={(e) => save({ weeklyChat: e.target.checked })}
            />
            <span>
              <span className="block text-sm font-semibold text-[#2d2418]">Weekly chat call (speech check)</span>
              <span className="block text-xs text-[#8a7560]">
                Every Sunday at 11 am, a short friendly call asks the same question (how she makes her morning tea). With at
                least 50 words, MedTime measures vocabulary, repetitions and word-finding the way the speech-screening research does,
                and compares them only with her own earlier weeks. Off by default; never a diagnosis.
              </span>
            </span>
          </label>
          <label className="block">
            <span className="block text-sm font-semibold text-[#2d2418] mb-1">Language on calls</span>
            <select
              className="border border-[#e8dcc8] rounded-lg px-3 py-2 text-sm"
              value={settings.language}
              disabled={saving}
              onChange={(e) => save({ language: e.target.value })}
            >
              <option value="en">English</option>
              <option value="hi">हिन्दी (Hindi)</option>
            </select>
          </label>
          <form
            className="block"
            onSubmit={(e) => { e.preventDefault(); save({ emergencyContact: e.target.elements.ec.value }); }}
          >
            <span className="block text-sm font-semibold text-[#2d2418] mb-1">Emergency contact</span>
            <span className="block text-xs text-[#8a7560] mb-2">
              Phoned for a fall, chest pain or a missed dose when no caregiver is linked. On the Twilio trial this number
              must also be verified in Twilio.
            </span>
            <div className="flex gap-2">
              <input
                name="ec"
                key={settings.emergencyContact}
                defaultValue={settings.emergencyContact}
                inputMode="tel"
                placeholder="10-digit mobile number"
                className="flex-1 border border-[#e8dcc8] rounded-lg px-3 py-2 text-sm"
              />
              <button type="submit" disabled={saving} className="bg-[#5c4535] text-white text-sm font-semibold px-4 rounded-lg disabled:opacity-60">Save</button>
            </div>
          </form>
          {msg && <p className={`text-xs ${msg.type === 'success' ? 'text-[#2a4a28]' : 'text-[#7a2a1a]'}`}>{msg.text}</p>}
        </>
      )}
    </div>
  );
}
