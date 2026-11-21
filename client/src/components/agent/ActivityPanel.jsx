import React, { useState, useEffect } from 'react';
import api from '../../utils/api';

export default function ActivityPanel({ patientId }) {
  const [runs, setRuns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState(null);

  const fetchRuns = async () => {
    if (!patientId) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/agent/runs?patient=${patientId}`);
      setRuns(res.data);
      if (res.data.length > 0 && !expandedRunId) {
        setExpandedRunId(res.data[0]._id); // Expand latest run by default
      }
    } catch (err) {
      console.error('Failed to fetch agent runs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, [patientId]);

  if (isLoading && runs.length === 0) {
    return <div className="text-sm text-[#8a7560] py-4">Loading Agent Activity...</div>;
  }

  if (runs.length === 0) {
    return null; // Don't crowd the dashboard if there are no agent runs yet
  }

  const getLabelBadge = (label) => {
    switch (label) {
      case 'patient_said':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            🗣️ Patient said
          </span>
        );
      case 'agent_noticed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            👁️ Agent noticed
          </span>
        );
      case 'action_taken':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-50 text-green-700 border border-green-200">
            ⚡ Action taken
          </span>
        );
    }
  };

  const getTriggerTitle = (trigger) => {
    switch (trigger) {
      case 'dose':
        return 'Scheduled Dose Call';
      case 'callin':
        return 'Patient Inbound Call ("Did I take my pills?")';
      case 'prescription':
        return 'Prescription-to-Schedule Run';
      case 'journal':
        return 'Evening Care Journal Synthesis';
      default:
        return 'Agent Run';
    }
  };

  return (
    <div className="bg-white rounded-[20px] p-6 border-[1.5px] border-[#e8dcc8] shadow-[0_2px_16px_rgba(90,60,30,0.08)] mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🤖</span>
          <div>
            <h2 className="text-xl font-bold text-[#5c4535]" style={{ fontFamily: "'Lora', serif" }}>
              Agent Activity & Decision Timeline
            </h2>
            <p className="text-xs text-[#8a7560]">
              Audited step-by-step reasoning, perceptions, and tool execution history (Contract C2).
            </p>
          </div>
        </div>
        <button
          onClick={fetchRuns}
          className="text-xs font-bold text-[#5c4535] hover:bg-[#f5ede0] px-3 py-1.5 rounded-lg border border-[#e8dcc8] transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="space-y-4">
        {runs.map((run) => {
          const isExpanded = expandedRunId === run._id;
          const timeStr = new Date(run.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
          const dateStr = new Date(run.createdAt).toLocaleDateString([], {
            month: 'short',
            day: 'numeric',
          });

          return (
            <div
              key={run._id}
              className="rounded-xl border border-[#e8dcc8] bg-[#fdfcf9] overflow-hidden transition-all shadow-sm"
            >
              {/* Header row */}
              <div
                onClick={() => setExpandedRunId(isExpanded ? null : run._id)}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-[#f5ede0]/40 transition-colors select-none"
              >
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold text-gray-900">
                    {getTriggerTitle(run.trigger)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {dateStr} at {timeStr}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border capitalize ${
                      run.status === 'completed'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : run.status === 'waiting_for_approval'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-gray-50 text-gray-700 border-gray-200'
                    }`}
                  >
                    {run.status.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-gray-400 font-mono">{run.steps?.length || 0} steps</span>
                  <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded Timeline */}
              {isExpanded && (
                <div className="px-5 pb-5 pt-2 border-t border-[#f5ede0] space-y-3 bg-white">
                  {/* Outcome summary */}
                  {run.outcome && (
                    <div className="p-3 bg-[#fdf8f0] rounded-xl border border-[#e8dcc8] text-xs font-medium text-[#5c4535]">
                      <span className="font-bold text-[11px] uppercase tracking-wider text-[#8a7560] block mb-0.5">
                        Outcome:
                      </span>
                      {run.outcome}
                    </div>
                  )}

                  {/* Step list */}
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-[#e8dcc8]">
                    {run.steps?.map((step, idx) => (
                      <div key={idx} className="relative">
                        {/* Bullet point icon */}
                        <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-[#5c4535] border-2 border-white" />

                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            {getLabelBadge(step.label)}
                            <span className="font-mono text-xs text-gray-500 font-semibold">
                              {step.tool} ({step.ms}ms)
                            </span>
                          </div>

                          <div className="text-xs text-gray-800 bg-gray-50/70 p-2.5 rounded-lg border border-gray-100">
                            {step.summaryText || JSON.stringify(step.input || {})}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Run metadata footer */}
                  <div className="pt-2 text-[11px] text-gray-400 flex items-center justify-between border-t border-gray-100">
                    <span>Model: {run.model || 'groq/gpt-oss-20b'}</span>
                    <span>Prompt v{run.promptVersion || '1.0.0'}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
