import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { CheckSquare } from 'lucide-react';

export default function ApprovalsPanel({ patientId, onUpdate }) {
  const [proposals, setProposals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchProposals = async () => {
    if (!patientId) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/proposals?patient=${patientId}&status=pending`);
      setProposals(res.data);
      if (onUpdate) onUpdate(res.data.length);
    } catch (err) {
      console.error('Failed to fetch proposals:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProposals();
  }, [patientId]);

  const handleApprove = async (id) => {
    setActionError(null);
    try {
      await api.post(`/proposals/${id}/approve`);
      fetchProposals();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to approve proposal.');
    }
  };

  const handleReject = async (id) => {
    setActionError(null);
    try {
      await api.post(`/proposals/${id}/reject`, { reason: rejectReason });
      setRejectingId(null);
      setRejectReason('');
      fetchProposals();
    } catch (err) {
      setActionError(err.response?.data?.message || 'Failed to reject proposal.');
    }
  };

  if (isLoading && proposals.length === 0) {
    return <div className="text-sm text-[#66756f] py-4">Checking for pending proposals...</div>;
  }

  if (proposals.length === 0) {
    return null; // Keep dashboard clean if no proposals are waiting
  }

  return (
    <div className="bg-white rounded-[20px] p-6 border-[1.5px] border-[#e2e9e5] shadow-[0_2px_16px_rgba(20,45,38,0.08)] mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-full bg-[#e3f2ea] text-[#2f6f5e] flex items-center justify-center shrink-0"><CheckSquare size={18} /></span>
          <div>
            <h2 className="text-xl font-bold text-[#2f6f5e]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              Pending Proposals Waiting for Approval
            </h2>
            <p className="text-xs text-[#66756f]">
              The AI agent planned these changes. Review the evidence and approve or reject.
            </p>
          </div>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
          {proposals.length} Waiting
        </span>
      </div>

      {actionError && (
        <div className="p-3 text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg mb-4">
          {actionError}
        </div>
      )}

      <div className="space-y-4">
        {proposals.map((item) => (
          <div
            key={item._id}
            className="p-5 rounded-xl border border-[#e2e9e5] bg-[#fafcfb] flex flex-col gap-3"
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 capitalize">
                  {item.kind.replace('_', ' ')}
                </span>
                <span
                  className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                    item.level === 2
                      ? 'bg-purple-50 text-purple-700 border-purple-200'
                      : 'bg-blue-50 text-blue-700 border-blue-200'
                  }`}
                >
                  {item.level === 2 ? 'Level 2: Doctor Approval' : 'Level 1: Caregiver Approval'}
                </span>
              </div>
              <span className="text-xs text-gray-400">
                Proposed {new Date(item.createdAt).toLocaleDateString()}
              </span>
            </div>

            {/* Evidence quote */}
            <div className="text-sm bg-[#eaf3ee]/60 p-3 rounded-lg border border-[#e2e9e5] text-[#2f6f5e]">
              <span className="font-bold text-xs uppercase tracking-wider text-[#66756f] block mb-1">
                Reason / Evidence:
              </span>
              "{item.evidence}"
            </div>

            {/* Details preview */}
            {item.payload && (
              <div className="text-xs text-gray-600 bg-gray-50 p-2.5 rounded-lg border border-gray-100 font-mono">
                {item.payload.name && <div>Medicine: {item.payload.name} ({item.payload.dosage})</div>}
                {item.payload.scheduledTimes && <div>Times: {item.payload.scheduledTimes.join(', ')}</div>}
                {item.payload.mealTiming && <div>Meal Timing: {item.payload.mealTiming}</div>}
              </div>
            )}

            {/* Actions */}
            {rejectingId === item._id ? (
              <div className="mt-2 space-y-2">
                <input
                  type="text"
                  placeholder="Reason for rejecting (optional)..."
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full text-xs p-2.5 border border-gray-200 rounded-lg outline-none focus:border-red-400"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleReject(item._id)}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700"
                  >
                    Confirm Rejection
                  </button>
                  <button
                    onClick={() => setRejectingId(null)}
                    className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => handleApprove(item._id)}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
                >
                  ✓ Approve Change
                </button>
                <button
                  onClick={() => {
                    setRejectingId(item._id);
                    setRejectReason('');
                  }}
                  className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                >
                  Reject
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
