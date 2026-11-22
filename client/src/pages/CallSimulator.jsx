// Browser voice call (A3.2, Person A). A real spoken dose call with the agent, in the browser:
// microphone in, the agent's voice out, and the conversation shown live.
//
// 1. Pick the patient (caregivers) and the medicine. The voice server then renders that call's
//    lines in the neutral voice ("Preparing the voice"), so nothing is generated during the call.
// 2. "Start call": the API starts a dose call (POST /simulate/call, channel "voice"), then the
//    browser connects to the voice server on this laptop (VITE_VOICE_URL, default
//    http://localhost:7860) over WebRTC. Speech recognition and the voice run there; the agent
//    runs in the API, as on a phone call.
// 3. Talk. Interrupt the agent at any time; it stops speaking. "Hang up" ends the call.
//
// The call records REAL doses for that patient, like the text simulator. Person B can mount the
// Agent Activity panel beside this page for the demo.

import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { PipecatClient } from '@pipecat-ai/client-js';
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';
import api from '../utils/api';

const VOICE_URL = (import.meta.env.VITE_VOICE_URL || 'http://localhost:7860').replace(/\/+$/, '');

export default function CallSimulator() {
  const { user } = useSelector((state) => state.auth);
  const isCaregiver = user?.role === 'caregiver';

  const [patients, setPatients] = useState([]);
  const [patientId, setPatientId] = useState('');
  const [doses, setDoses] = useState(null);
  const [medicineId, setMedicineId] = useState('');
  const [status, setStatus] = useState('idle'); // idle | starting | live | ending | ended | error
  const [error, setError] = useState('');
  const [lines, setLines] = useState([]); // { who: 'agent' | 'patient' | 'system', text, lineId?, emergency? }
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [prep, setPrep] = useState(null); // { cached, total, preparing } | { error }
  const clientRef = useRef(null);
  const endingRef = useRef(false);
  const bottomRef = useRef(null);
  const audioRef = useRef(null); // the agent's voice (the library doesn't play remote audio itself)

  const add = (line) => setLines((ls) => [...ls, line]);

  // Caregivers pick a patient; a patient calls about their own medicines.
  useEffect(() => {
    if (!isCaregiver) return;
    api.get('/caregiver/dashboard')
      .then((r) => setPatients((r.data || []).map((p) => ({ id: String(p.patientId), name: p.name }))))
      .catch(() => setError('Could not load your patients.'));
  }, [isCaregiver]);

  useEffect(() => {
    if (isCaregiver && !patientId) return;
    setDoses(null);
    setMedicineId('');
    api.get('/simulate/doses', { params: isCaregiver ? { patient: patientId } : {} })
      .then((r) => {
        setDoses(r.data);
        if (r.data.medicines.length) setMedicineId(r.data.medicines[0].medicineId);
      })
      .catch((e) => setError(e.response?.data?.message || 'Could not load the medicines.'));
  }, [isCaregiver, patientId]);

  // Have the voice server render this call's lines before the call (about 2 minutes the first time,
  // instant after that), checking progress every 2 seconds.
  useEffect(() => {
    const med = doses?.medicines.find((m) => m.medicineId === medicineId);
    if (!med?.lines?.length) { setPrep(null); return undefined; }
    let stopped = false;
    let timer;
    const poll = async () => {
      try {
        const r = await fetch(`${VOICE_URL}/api/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lines: med.lines }) });
        const p = await r.json();
        if (stopped) return;
        setPrep(p);
        if (p.preparing) timer = setTimeout(poll, 2000);
      } catch {
        if (!stopped) setPrep({ error: `The voice server isn't reachable at ${VOICE_URL}. Start it with: cd voice, then .venv\\Scripts\\python -I bot.py` });
      }
    };
    setPrep(null);
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [doses, medicineId]);

  // Braces: newer Chrome returns a Promise from scrollIntoView, and an effect may only return a
  // clean-up function (returning it crashed the page).
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);
  useEffect(() => () => { clientRef.current?.disconnect(); }, []); // hang up when leaving the page

  const hangUp = async () => {
    setStatus('ending');
    try { await clientRef.current?.disconnect(); } catch { /* already closed */ }
    clientRef.current = null;
    setStatus('ended');
  };

  const startCall = async () => {
    setError('');
    setLines([]);
    endingRef.current = false;
    setStatus('starting');
    try {
      // 1. the agent's opening turn, from the API
      const { data: call } = await api.post('/simulate/call', { medicineId, channel: 'voice' });
      add({ who: 'system', text: `Call started (run ${call.runId || '-'}).` });

      // 2. the voice connection to this laptop's voice server
      const client = new PipecatClient({
        transport: new SmallWebRTCTransport(),
        enableMic: true,
        enableCam: false,
        callbacks: {
          onServerMessage: (m) => {
            if (m?.type === 'agent') add({ who: 'agent', text: m.text, lineId: m.lineId });
            else if (m?.type === 'patient') add({ who: 'patient', text: m.text });
            else if (m?.type === 'emergency') add({ who: 'system', text: `Emergency: ${String(m.category).replace(/_/g, ' ')}. Caregiver alerted.`, emergency: true });
            else if (m?.type === 'ended') endingRef.current = true;
          },
          // The agent said its last line: hang up once it has finished speaking.
          onBotStoppedSpeaking: () => { if (endingRef.current) setTimeout(hangUp, 600); },
          // The agent's audio arrives as a WebRTC track: play it through the hidden <audio>.
          onTrackStarted: (track, participant) => {
            if (track.kind !== 'audio' || participant?.local || !audioRef.current) return;
            audioRef.current.srcObject = new MediaStream([track]);
            audioRef.current.play().catch(() => setError("Click anywhere on the page to let the browser play the agent's voice."));
          },
          onUserStartedSpeaking: () => setUserSpeaking(true),
          onUserStoppedSpeaking: () => setUserSpeaking(false),
          onDisconnected: () => setStatus((s) => (s === 'error' ? s : 'ended')),
          onError: (m) => { setError(m?.data?.message || 'Voice connection error.'); setStatus('error'); },
        },
      });
      clientRef.current = client;
      await client.connect({
        webrtcRequestParams: {
          endpoint: `${VOICE_URL}/api/offer`,
          requestData: { callId: call.callId, actions: call.actions, hints: call.hints },
        },
      });
      setStatus('live');
    } catch (e) {
      clientRef.current = null;
      setError(e.response?.data?.message || e.message || 'Could not start the call. Is the voice server running?');
      setStatus('error');
    }
  };

  const busy = status === 'starting' || status === 'live' || status === 'ending';
  const meds = doses?.medicines || [];

  return (
    <div className="min-h-screen bg-[#faf6ef] p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-[#5c4535]" style={{ fontFamily: "'Lora', serif" }}>Voice dose call</h1>
        <p className="text-sm text-[#8a7560] mt-1">
          A spoken dose call with the agent. Speak normally; you can interrupt it. This records real doses for the patient.
        </p>

        <div className="mt-5 bg-white rounded-[18px] border-[1.5px] border-[#e8dcc8] p-5 flex flex-wrap gap-3 items-end">
          {isCaregiver && (
            <label className="flex flex-col text-xs font-bold text-[#5c4535]">
              Patient
              <select className="mt-1 border rounded-lg px-3 py-2 text-sm font-normal" value={patientId} disabled={busy}
                onChange={(e) => setPatientId(e.target.value)}>
                <option value="">Choose…</option>
                {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col text-xs font-bold text-[#5c4535]">
            Medicine
            <select className="mt-1 border rounded-lg px-3 py-2 text-sm font-normal min-w-[220px]" value={medicineId} disabled={busy || !meds.length}
              onChange={(e) => setMedicineId(e.target.value)}>
              {!meds.length && <option value="">{doses ? 'No active medicines' : 'Loading…'}</option>}
              {meds.map((m) => (
                <option key={m.medicineId} value={m.medicineId}>
                  {m.name} {m.dosage} ({(m.times || []).join(', ')}){m.openReminderId ? '' : ' · new dose now'}
                </option>
              ))}
            </select>
          </label>
          {!busy ? (
            <button onClick={startCall} disabled={!medicineId || !prep || prep.error || prep.preparing}
              className="bg-sage2 text-[#1e3a1d] px-5 py-2 rounded-lg font-bold text-sm border-2 border-sage2 disabled:opacity-50">
              📞 Start call
            </button>
          ) : (
            <button onClick={hangUp} className="bg-blush2 text-[#7a2a1a] px-5 py-2 rounded-lg font-bold text-sm border-2 border-blush2">
              ⏹ Hang up
            </button>
          )}
          <span className="text-xs text-[#8a7560] ml-auto">
            {!busy && prep?.preparing && `Preparing the voice… ${prep.cached}/${prep.total} lines`}
            {!busy && prep && !prep.preparing && !prep.error && status === 'idle' && 'Voice ready'}
            {status === 'starting' && 'Connecting…'}
            {status === 'live' && (userSpeaking ? '🎙️ Listening to you…' : '🔊 Call in progress')}
            {status === 'ended' && 'Call ended'}
          </span>
        </div>

        <audio ref={audioRef} autoPlay playsInline className="hidden" />
        {error && <div className="mt-3 p-3 rounded-xl bg-[#ffebee] text-[#b71c1c] text-sm">{error}</div>}
        {prep?.error && <div className="mt-3 p-3 rounded-xl bg-[#fff8e1] text-[#7a5a10] text-sm">{prep.error}</div>}

        <div className="mt-5 bg-white rounded-[18px] border-[1.5px] border-[#e8dcc8] p-5 min-h-[260px] space-y-3">
          {lines.length === 0 && <p className="text-sm text-[#8a7560]">The conversation appears here.</p>}
          {lines.map((l, i) => (
            <div key={i} className={`flex ${l.who === 'patient' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                l.who === 'patient' ? 'bg-[#e3f2fd] text-[#0d3c61]'
                  : l.who === 'agent' ? 'bg-[#f5ede0] text-[#5c4535]'
                  : l.emergency ? 'bg-[#ffcdd2] text-[#b71c1c] font-bold' : 'bg-gray-50 text-gray-500 text-xs'}`}>
                {l.who === 'agent' && <div className="text-[10px] uppercase tracking-wider text-[#8a7560]">Agent · neutral voice{l.lineId ? ` · ${l.lineId}` : ''}</div>}
                {l.who === 'patient' && <div className="text-[10px] uppercase tracking-wider text-[#5a7fa0]">Patient</div>}
                {l.text}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
