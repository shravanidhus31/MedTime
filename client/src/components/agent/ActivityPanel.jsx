import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { runTitle, stepText, stepKind } from './activityText';
import { Activity } from 'lucide-react';

// live: refresh every 2 s and keep the newest run open (beside the voice call, for the demo).
export default function ActivityPanel({ patientId, live = false }) {
  const [runs, setRuns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState(null);

  const fetchRuns = async (quiet = false) => {
    if (!patientId) return;
    if (!quiet) setIsLoading(true);
    try {
      // Person A's C2 endpoint: { runs: [...] }; steps=1 includes each run's timeline.
      const res = await api.get(`/agent/runs?patient=${patientId}&steps=1&limit=30`);
      const list = Array.isArray(res.data) ? res.data : res.data.runs || [];
      setRuns(list);
      if (list.length > 0) {
        // Expand the latest run by default; while live, follow the newest one.
        setExpandedRunId((current) => (live || !current ? list[0]._id : current));
      }
    } catch (err) {
      console.error('Failed to fetch agent runs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
    if (!live) return undefined;
    const timer = setInterval(() => fetchRuns(true), 2000);
    return () => clearInterval(timer);
  }, [patientId, live]);

  if (isLoading && runs.length === 0) {
    return <div className="text-sm text-[#66756f] py-4">Loading Agent Activity...</div>;
  }

  if (runs.length === 0) {
    return null; // Don't crowd the dashboard if there are no agent runs yet
  }

  const getLabelBadge = (label) => {
    switch (label) {
      case 'patient_said':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            Patient said
          </span>
        );
      case 'agent_noticed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
            Agent noticed
          </span>
        );
      case 'action_taken':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-50 text-green-700 border border-green-200">
            Action taken
          </span>
        );
    }
  };

  return (
    <div className="bg-white rounded-[20px] p-6 border-[1.5px] border-[#e2e9e5] shadow-[0_2px_16px_rgba(20,45,38,0.08)] mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-full bg-[#e3f2ea] text-[#2f6f5e] flex items-center justify-center shrink-0"><Activity size={18} /></span>
          <div>
            <h2 className="text-xl font-bold text-[#2f6f5e]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              What the agent did
            </h2>
            <p className="text-xs text-[#66756f]">
              Every call and background task, step by step: what she said, what the agent checked, and what it decided.
            </p>
          </div>
        </div>
        <button
          onClick={fetchRuns}
          className="text-xs font-bold text-[#2f6f5e] hover:bg-[#eaf3ee] px-3 py-1.5 rounded-lg border border-[#e2e9e5] transition-colors"
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
              className="rounded-xl border border-[#e2e9e5] bg-[#fafcfb] overflow-hidden transition-all shadow-sm"
            >
              {/* Header row */}
              <div
                onClick={() => setExpandedRunId(isExpanded ? null : run._id)}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-[#eaf3ee]/40 transition-colors select-none"
              >
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold text-gray-900">
                    {runTitle(run)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {dateStr} at {timeStr}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border capitalize ${
                      run.status === 'completed' || run.status === 'finished'
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : run.status === 'waiting_for_approval'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-gray-50 text-gray-700 border-gray-200'
                    }`}
                  >
                    {String(run.status || '').replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-gray-400 font-mono">{run.steps?.length || 0} steps</span>
                  <span className="text-gray-400">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded Timeline */}
              {isExpanded && (
                <div className="px-5 pb-5 pt-2 border-t border-[#eaf3ee] space-y-3 bg-white">
                  {/* Outcome summary */}
                  {(run.text || run.outcome) && (
                    <div className="p-3 bg-[#f4f7f5] rounded-xl border border-[#e2e9e5] text-xs font-medium text-[#2f6f5e]">
                      <span className="font-bold text-[11px] uppercase tracking-wider text-[#66756f] block mb-0.5">
                        Outcome:
                      </span>
                      {/* Person A's runs keep a one-line summary in text; outcome is then a code word. */}
                      {run.text || run.outcome}
                    </div>
                  )}

                  {/* Step list */}
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-[#e2e9e5]">
                    {run.steps?.map((step, idx) => (
                      <div key={idx} className="relative">
                        {/* Bullet point icon */}
                        <div className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-[#2f6f5e] border-2 border-white" />

                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            {getLabelBadge(stepKind(step))}
                            <span className="text-[10px] text-gray-400">
                              {step.at ? new Date(step.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' }) : ''}
                            </span>
                          </div>

                          <div className="text-sm text-[#1c2b26] leading-snug">
                            {stepText(step)}
                          </div>
                          <details className="text-[10px] text-gray-400">
                            <summary className="cursor-pointer select-none">Details</summary>
                            <pre className="mt-1 whitespace-pre-wrap break-all bg-gray-50 p-2 rounded border border-gray-100">{`${step.tool} · ${step.ms || 0} ms`}<br />{JSON.stringify({ input: step.input, output: step.output }, null, 1).slice(0, 1500)}</pre>
                          </details>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Run metadata footer */}
                  <div className="pt-2 text-[11px] text-gray-400 flex items-center justify-between border-t border-gray-100">
                    <span>{run.model ? `Model: ${run.model}` : 'Rules only (no model)'}</span>
                    <span>{run.promptVersion || ''}</span>
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
