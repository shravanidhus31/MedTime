import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { BookOpen } from 'lucide-react';

/**
 * JournalPanel — Feature 6 (B8)
 *
 * Displays the Daily Care Journal generated nightly (9 PM IST) for dementia patients.
 * Highlights attention items (missed doses, red flags, refill alerts) first.
 * Caregivers can review, flag incorrect lines, and manually regenerate notes.
 */
export default function JournalPanel({ patientId }) {
  const [entries, setEntries] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const fetchJournal = async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/journal?patient=${patientId}&date=${selectedDate}`);
      setEntries(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load daily journal');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJournal();
  }, [patientId, selectedDate]);

  const handleGenerateToday = async () => {
    if (!patientId) return;
    setGenerating(true);
    setError(null);
    try {
      await api.post('/journal/generate', { patientId, date: selectedDate });
      await fetchJournal();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to generate journal');
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleWrong = async (journalId, lineIndex) => {
    try {
      const res = await api.patch(`/journal/${journalId}/lines/${lineIndex}/wrong`);
      setEntries((prev) =>
        prev.map((entry) => (entry._id === journalId ? res.data.data : entry))
      );
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to update line flag');
    }
  };

  const currentEntry = entries[0] || null;

  const getSourceBadge = (source) => {
    switch (source) {
      case 'patient_said':
        return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">Patient said</span>;
      case 'agent_noticed':
        return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">Agent noticed</span>;
      case 'action_taken':
        return <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Action taken</span>;
      default:
        return null;
    }
  };

  const isAttentionLine = (text) => {
    const lower = text.toLowerCase();
    return lower.includes('safety alert') || lower.includes('red flag') || lower.includes('missed') || lower.includes('refill') || lower.includes('waiting for');
  };

  return (
    <div className="bg-white rounded-[24px] p-6 border-[1.5px] border-[#e2e9e5] shadow-[0_2px_16px_rgba(20,45,38,0.08)] mb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#e6eee9]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#f6f9f7] text-[#2f6f5e] flex items-center justify-center font-bold text-xl border border-[#e2e9e5]"><BookOpen size={18} /></div>
          <div>
            <h3 className="text-xl font-bold text-[#1c2b26]">Daily Care Journal</h3>
            <p className="text-xs text-[#66756f]">
              Nightly summary (9:00 PM IST) for clinical and family review. Attention items appear first.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[#e2e9e5] text-[#2f6f5e] bg-[#f8faf9] focus:outline-none"
          />
          <button
            onClick={handleGenerateToday}
            disabled={generating}
            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#2f6f5e] text-white hover:bg-[#255a4c] transition-colors disabled:opacity-50"
          >
            {generating ? 'Compiling...' : 'Compile Journal'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="mt-5">
        {loading ? (
          <div className="py-8 text-center text-xs text-[#66756f]">Loading care journal...</div>
        ) : !currentEntry || !currentEntry.lines || currentEntry.lines.length === 0 ? (
          <div className="py-8 text-center bg-[#f8faf9] rounded-xl border border-dashed border-[#e2e9e5]">
            <p className="text-sm font-semibold text-[#66756f]">No care journal recorded for {selectedDate}</p>
            <p className="text-xs text-[#93a59e] mt-1">
              Click &quot;Compile Journal&quot; to synthesize today&apos;s interactions and adherence into care notes.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-[#66756f] px-1">
              <span>{currentEntry.lines.length} care observations recorded</span>
              <span>Updated: {new Date(currentEntry.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>

            <div className="space-y-2">
              {currentEntry.lines.map((line, idx) => {
                const attention = isAttentionLine(line.text);
                return (
                  <div
                    key={idx}
                    className={`flex items-start justify-between gap-3 p-3.5 rounded-xl border transition-all ${
                      line.markedWrong
                        ? 'bg-gray-50 border-gray-200 opacity-60'
                        : attention
                        ? 'bg-amber-50/60 border-amber-200 shadow-sm'
                        : 'bg-white border-[#e6eee9] hover:border-[#e2e9e5]'
                    }`}
                  >
                    <div className="flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        {getSourceBadge(line.source)}
                        {attention && !line.markedWrong && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 uppercase tracking-wider">
                            Attention
                          </span>
                        )}
                        {line.markedWrong && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-700 uppercase tracking-wider">
                            Flagged Incorrect
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-sm leading-relaxed ${
                          line.markedWrong ? 'line-through text-gray-400' : 'text-[#1c2b26]'
                        } ${line.source === 'patient_said' ? 'italic font-serif' : ''}`}
                      >
                        {line.text}
                      </p>
                    </div>

                    <button
                      onClick={() => handleToggleWrong(currentEntry._id, idx)}
                      title={line.markedWrong ? 'Unmark line' : 'Mark as inaccurate for AI memory'}
                      className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors shrink-0 ${
                        line.markedWrong
                          ? 'border-gray-300 text-gray-600 bg-white hover:bg-gray-100'
                          : 'border-red-200 text-red-600 hover:bg-red-50'
                      }`}
                    >
                      {line.markedWrong ? '↺ Restore' : '✕ Mark Wrong'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
