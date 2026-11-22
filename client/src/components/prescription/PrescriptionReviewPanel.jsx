import React, { useState, useEffect, useCallback } from 'react';
import api from '../../utils/api';

/**
 * PrescriptionReviewPanel — B12 (Feature 8: Prescription-to-Schedule Agent)
 *
 * Shows pending `new_schedule` ProposedChange records from OCR prescription scans.
 * For each proposal:
 *  - Level 1 (clear scan, no conflicts) → one-tap "Approve" by caregiver.
 *  - Level 2 (conflicts / low-confidence) or escalated → a doctor approves (the server checks).
 *
 * Rules enforced:
 *  - No Medicine is created until approved here.
 *  - Low-confidence fields are shown as "Couldn't read" badges.
 *  - Conflicts are explained in plain language.
 */

// The reader gives "high" | "medium" | "low" per field (22 Nov: the panel expected numbers, so
// every cell showed "—").
const CONF = { high: 1, medium: 0.6, low: 0 };

function ConfidenceBadge({ value, confidence: c }) {
  const confidence = typeof c === 'string' ? CONF[c] : c;
  if (confidence === null || confidence === undefined) return <span className="text-[#2d2418]">{value ?? '—'}</span>;
  if (confidence < 0.5 || value === null || value === undefined) {
    return (
      <span className="bg-[#f7ddd4] text-[#7a2a1a] text-xs px-2 py-0.5 rounded-full font-semibold">
        ⚠ Couldn't read
      </span>
    );
  }
  if (confidence < 0.75) {
    return (
      <span className="text-[#8a7560]">
        {value} <span className="text-[10px] text-[#c5a87a]">(uncertain)</span>
      </span>
    );
  }
  return <span className="text-[#2d2418]">{value}</span>;
}

function ConflictExplainer({ conflicts }) {
  if (!conflicts || conflicts.length === 0) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-3">
      <p className="text-xs font-semibold text-amber-800 mb-2">⚠ Potential Conflicts Detected</p>
      <ul className="space-y-1">
        {conflicts.map((c, i) => (
          <li key={i} className="text-xs text-amber-700">
            • {c.name && <strong>{c.name}</strong>}
            {c.reason === 'duplicate' && <span> is already in the active schedule — this may be a duplicate. Review before approving.</span>}
            {c.reason === 'strength_change' && <span> has a different dose strength than the current schedule ({c.currentDosage} → {c.newDosage}). A doctor should confirm this change.</span>}
            {c.reason === 'interaction' && <span> may interact with an existing medicine. Please verify with the prescribing doctor.</span>}
            {!c.reason && <span>: {c.detail || 'Review required'}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Food rule vs her meals (B12): explained, with a suggested time; the caregiver decides.
function TimingWarnings({ medicines }) {
  const warnings = medicines.flatMap((m) => m.timingConflicts || []);
  if (!warnings.length) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-3">
      <p className="text-xs font-semibold text-amber-800 mb-2">⏰ Food timing doesn't fit her meals</p>
      <ul className="space-y-1">
        {warnings.map((w, i) => <li key={i} className="text-xs text-amber-700">• {w.message}</li>)}
      </ul>
      <p className="text-[11px] text-amber-700 mt-2">You can approve as it is and change the time afterwards, or ask the doctor.</p>
    </div>
  );
}

function MedicineRow({ med, idx }) {
  const conf = med.confidence || {
    name: med.nameConfidence,
    dosage: med.strengthConfidence,
    frequency: med.frequencyConfidence,
    mealTiming: med.foodRuleConfidence,
  };
  return (
    <tr className="border-b border-[#fdf8f0] last:border-0">
      <td className="py-3 pr-4 text-sm font-medium text-[#2d2418] align-top">
        {idx + 1}. <ConfidenceBadge value={med.name} confidence={conf.name} />
      </td>
      <td className="py-3 pr-4 text-sm align-top">
        <ConfidenceBadge value={med.strength || med.dosage} confidence={conf.dosage} />
      </td>
      <td className="py-3 pr-4 text-sm align-top">
        <ConfidenceBadge value={med.frequency} confidence={conf.frequency} />
      </td>
      <td className="py-3 pr-4 text-sm align-top">
        <ConfidenceBadge value={med.foodRule || med.mealTiming} confidence={conf.mealTiming} />
      </td>
      <td className="py-3 pr-4 text-sm align-top text-[#2d2418]">
        {(med.scheduledTimes || []).join(', ') || '—'}
      </td>
      <td className="py-3 text-sm align-top">
        {med.pillboxSlot
          ? <span className="bg-[#c5dff0] text-[#1a3e5a] text-xs px-2 py-0.5 rounded-full font-semibold">{med.pillboxSlot}</span>
          : <span className="text-[#8a7560] text-xs">Auto-assign</span>}
      </td>
    </tr>
  );
}

function ProposalCard({ proposal, onApprove, onEscalate }) {
  const [approving, setApproving] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [localMsg, setLocalMsg] = useState(null);

  // Level 2, or escalated: a doctor approves (the server checks; a caregiver gets a clear refusal).
  const escalated = proposal.status === 'escalated';
  const isLevel2 = proposal.level === 2 || proposal.approvalLevel === 2 || escalated;
  const medicines = proposal.payload?.medicines || proposal.medicines || [];
  const conflicts = medicines
    .filter((m) => m.isDuplicate || m.isStrengthChange)
    .map((m) => ({ name: m.name, reason: m.isDuplicate ? 'duplicate' : null, detail: m.conflictNotes || 'Strength change: a doctor should confirm this.' }));
  const lowConfidenceCount = medicines.reduce((n, m) => n + ['nameConfidence', 'strengthConfidence', 'frequencyConfidence'].filter((k) => m[k] === 'low').length, 0);
  const rawText = proposal.payload?.ocrTextSample || proposal.payload?.rawText;

  const approve = async () => {
    setApproving(true);
    setLocalMsg(null);
    try {
      await api.post(`/ocr/approve/${proposal._id}`);
      setLocalMsg({ type: 'success', text: 'Schedule approved and medicines added!' });
      setTimeout(() => onApprove(proposal._id), 1200);
    } catch (err) {
      setLocalMsg({ type: 'error', text: err?.response?.data?.message || err?.response?.data?.error || 'Approval failed.' });
    } finally {
      setApproving(false);
    }
  };

  const escalate = async () => {
    setEscalating(true);
    setLocalMsg(null);
    try {
      await api.post(`/ocr/escalate/${proposal._id}`);
      setLocalMsg({ type: 'success', text: 'Escalated to doctor for review.' });
      setTimeout(() => onEscalate(proposal._id), 1200);
    } catch (err) {
      setLocalMsg({ type: 'error', text: err?.response?.data?.message || err?.response?.data?.error || 'Escalation failed.' });
    } finally {
      setEscalating(false);
    }
  };

  return (
    <div className={`bg-white rounded-2xl border p-5 space-y-4 ${isLevel2 ? 'border-amber-300' : 'border-[#e8dcc8]'}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-[#2d2418]">
              📋 Prescription Scan
            </span>
            {isLevel2 ? (
              <span className="bg-amber-100 text-amber-800 text-xs px-2 py-0.5 rounded-full font-semibold">
                {escalated ? 'Escalated — waiting for the doctor' : 'Level 2 — Doctor Approval Required'}
              </span>
            ) : (
              <span className="bg-[#c8d9c4] text-[#2a4a28] text-xs px-2 py-0.5 rounded-full font-semibold">
                Level 1 — Caregiver Can Approve
              </span>
            )}
          </div>
          <p className="text-xs text-[#8a7560] mt-1">
            Scanned {new Date(proposal.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
            {proposal.agentRunId && ` · Run ${String(proposal.agentRunId).slice(-6)}`}
          </p>
        </div>
        <span className="text-xs text-[#8a7560] bg-[#fdf8f0] px-2 py-1 rounded-full whitespace-nowrap">
          {medicines.length} medicine{medicines.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Medicines Table */}
      {medicines.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[480px]">
            <thead>
              <tr className="text-xs text-[#8a7560] border-b border-[#e8dcc8]">
                <th className="pb-2 pr-4 font-medium">Medicine</th>
                <th className="pb-2 pr-4 font-medium">Dosage</th>
                <th className="pb-2 pr-4 font-medium">Frequency</th>
                <th className="pb-2 pr-4 font-medium">With/Before/After Food</th>
                <th className="pb-2 pr-4 font-medium">Times</th>
                <th className="pb-2 font-medium">Pillbox Slot</th>
              </tr>
            </thead>
            <tbody>
              {medicines.map((med, i) => (
                <MedicineRow key={i} med={med} idx={i} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Conflict Explainer */}
      <ConflictExplainer conflicts={conflicts} />
      <TimingWarnings medicines={medicines} />

      {/* Low-confidence note */}
      {lowConfidenceCount > 0 && (
        <p className="text-xs text-[#8a7560] italic">
          ⚠ {lowConfidenceCount} field(s) could not be read clearly from the prescription. These are marked as "Couldn't read" above and will not be auto-filled.
        </p>
      )}

      {/* Raw text */}
      {rawText && (
        <details className="text-xs text-[#8a7560]">
          <summary className="cursor-pointer hover:text-[#5c4535]">View raw scan text</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs bg-[#fdf8f0] p-3 rounded-lg border border-[#e8dcc8] max-h-32 overflow-y-auto">
            {rawText}
          </pre>
        </details>
      )}

      {/* Actions */}
      {localMsg && (
        <div className={`text-sm px-4 py-2 rounded-lg ${
          localMsg.type === 'success'
            ? 'bg-[#c8d9c4] text-[#2a4a28]'
            : 'bg-[#f7ddd4] text-[#7a2a1a]'
        }`}>
          {localMsg.text}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={approve}
          disabled={approving}
          className="flex-1 bg-[#5c4535] text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-[#4a3628] disabled:opacity-50 transition-colors"
        >
          {approving ? 'Approving…' : isLevel2 ? '✓ Approve (doctor)' : '✓ Approve Schedule'}
        </button>
        {!escalated && <button
          onClick={escalate}
          disabled={escalating}
          className={`flex-1 border-[1.5px] border-amber-400 text-amber-800 bg-amber-50 py-2.5 rounded-xl font-semibold text-sm hover:bg-amber-100 disabled:opacity-50 transition-colors ${isLevel2 ? 'w-full' : ''}`}
        >
          {escalating ? 'Escalating…' : '🏥 Escalate to Doctor'}
        </button>}
      </div>
    </div>
  );
}

export default function PrescriptionReviewPanel({ patientId }) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    api.get(`/ocr/proposals/${patientId}`)
      .then(res => setProposals(res.data?.proposals || []))
      .catch(() => setError('Could not load prescription proposals.'))
      .finally(() => setLoading(false));
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  const removeProposal = (id) => {
    setProposals(prev => prev.filter(p => p._id !== id));
  };

  if (!patientId) return null;

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-[#e8dcc8] p-6">
        <p className="text-sm text-[#8a7560] animate-pulse">Loading prescription proposals…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-[#e8dcc8] p-6">
        <p className="text-sm text-[#7a2a1a]">{error}</p>
        <button onClick={load} className="mt-2 text-xs text-[#5c4535] underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-[#2d2418]">🔬 Prescription Reviews</h2>
        <button
          onClick={load}
          className="text-xs text-[#5c4535] bg-[#fdf8f0] border border-[#e8dcc8] px-3 py-1.5 rounded-full hover:bg-[#f5ede0] transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {proposals.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#e8dcc8] p-8 text-center">
          <p className="text-2xl mb-2">✅</p>
          <p className="text-sm font-medium text-[#2d2418]">No pending prescription reviews</p>
          <p className="text-xs text-[#8a7560] mt-1">
            When a caregiver or patient uploads a prescription photo, it will appear here for approval.
          </p>
        </div>
      ) : (
        proposals.map(proposal => (
          <ProposalCard
            key={proposal._id}
            proposal={proposal}
            onApprove={removeProposal}
            onEscalate={removeProposal}
          />
        ))
      )}
    </div>
  );
}
