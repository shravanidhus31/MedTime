import React, { useState, useEffect } from 'react';
import api from '../../utils/api';

/**
 * WeeklyReviewPanel — B14 (Features 1 & 3: Cognitive & Behavioral Trends)
 *
 * Visualizes speech rate, answering latency, repetition, and sundowning patterns
 * compared against the patient's 4-week baseline at the same time of day.
 */

export default function WeeklyReviewPanel({ patientId }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState(null);

  const fetchReviews = async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const res = await api.get(`/weekly-review/${patientId}`);
      setReviews(res.data?.reviews || []);
    } catch {
      // no reviews is fine
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
  }, [patientId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setMsg(null);
    try {
      await api.post(`/weekly-review/generate/${patientId}`);
      setMsg({ type: 'success', text: 'New weekly review generated successfully.' });
      fetchReviews();
    } catch (err) {
      setMsg({ type: 'error', text: err?.response?.data?.error || 'Failed to generate review.' });
    } finally {
      setGenerating(false);
    }
  };

  const handleFeedback = async (reviewId, accurate) => {
    try {
      await api.post(`/weekly-review/${reviewId}/feedback`, { markedAccurate: accurate });
      setReviews(prev => prev.map(r => r._id === reviewId ? {
        ...r,
        caregiverFeedback: { ...r.caregiverFeedback, markedAccurate: accurate }
      } : r));
    } catch {
      // ignore
    }
  };

  if (!patientId) return null;

  return (
    <div className="bg-white rounded-2xl border border-[#e8dcc8] p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-[#2d2418]">📊 Weekly Cognitive & Behavioral Review</h2>
          <p className="text-xs text-[#8a7560] mt-0.5">
            Tracks speech rate, response latency, and evening sundowning trends against baseline
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="bg-[#5c4535] text-white px-4 py-2 rounded-xl text-xs font-semibold hover:bg-[#4a3628] disabled:opacity-50 transition-colors"
        >
          {generating ? 'Analyzing…' : '⚡ Run Weekly Analysis'}
        </button>
      </div>

      {msg && (
        <div className={`text-xs px-3 py-2 rounded-lg ${
          msg.type === 'success' ? 'bg-[#c8d9c4] text-[#2a4a28]' : 'bg-[#f7ddd4] text-[#7a2a1a]'
        }`}>
          {msg.text}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-[#8a7560] animate-pulse">Loading weekly trend data…</p>
      ) : reviews.length === 0 ? (
        <div className="text-center py-8 bg-[#fdf8f0] rounded-xl border border-[#e8dcc8]">
          <p className="text-sm font-semibold text-[#2d2418]">No weekly reviews yet</p>
          <p className="text-xs text-[#8a7560] mt-1 max-w-sm mx-auto">
            Click "Run Weekly Analysis" or wait for the automatic Sunday review to see speech latency and sundowning patterns.
          </p>
        </div>
      ) : (
        reviews.map(review => {
          const { baselineMetrics, currentWeekMetrics, deltas, findings, sundowning } = review;
          return (
            <div key={review._id} className="border border-[#e8dcc8] rounded-xl p-5 space-y-5 bg-[#faf6f0]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#5c4535] bg-[#f5ede0] px-3 py-1 rounded-full">
                  Week of {new Date(review.weekStartDate).toLocaleDateString()} – {new Date(review.weekEndDate).toLocaleDateString()}
                </span>
                <span className="text-xs text-[#8a7560]">Status: Published</span>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white p-3 rounded-lg border border-[#e8dcc8]">
                  <div className="text-xs text-[#8a7560]">Response Latency</div>
                  <div className="text-lg font-bold text-[#2d2418]">{currentWeekMetrics?.latencyMs || 0} ms</div>
                  <div className={`text-[11px] font-semibold mt-1 ${
                    (deltas?.latencyPercent || 0) > 25 ? 'text-amber-700' : 'text-emerald-700'
                  }`}>
                    {deltas?.latencyPercent >= 0 ? '+' : ''}{deltas?.latencyPercent || 0}% vs. baseline ({baselineMetrics?.latencyMs || 0}ms)
                  </div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-[#e8dcc8]">
                  <div className="text-xs text-[#8a7560]">Speech Rate</div>
                  <div className="text-lg font-bold text-[#2d2418]">{currentWeekMetrics?.speechRateWpm || 0} WPM</div>
                  <div className={`text-[11px] font-semibold mt-1 ${
                    Math.abs(deltas?.speechRatePercent || 0) > 25 ? 'text-amber-700' : 'text-emerald-700'
                  }`}>
                    {deltas?.speechRatePercent >= 0 ? '+' : ''}{deltas?.speechRatePercent || 0}% vs. baseline ({baselineMetrics?.speechRateWpm || 0} WPM)
                  </div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-[#e8dcc8]">
                  <div className="text-xs text-[#8a7560]">Phrase Repetition</div>
                  <div className="text-lg font-bold text-[#2d2418]">{currentWeekMetrics?.repeatedPhrasesAvg || 0} / turn</div>
                  <div className="text-[11px] font-semibold text-emerald-700 mt-1">
                    Baseline: {baselineMetrics?.repeatedPhrasesAvg || 0}
                  </div>
                </div>
              </div>

              {/* Sundowning Alert (Feature 3) */}
              {sundowning?.detected && (
                <div className="bg-amber-50 border border-amber-300 p-4 rounded-xl flex items-start gap-3">
                  <span className="text-2xl">🌅</span>
                  <div>
                    <h4 className="text-xs font-bold text-amber-900">Sundowning Pattern Detected (Feature 3)</h4>
                    <p className="text-xs text-amber-800 mt-1">
                      {sundowning.eveningEventCount} evening disorientation events recorded across the past {sundowning.weeksObserved} weeks.
                      The agent recommends moving the evening call 30 minutes earlier before twilight to reduce anxiety.
                    </p>
                    {sundowning.proposalId && (
                      <span className="inline-block mt-2 text-[11px] font-semibold bg-amber-200 text-amber-900 px-2 py-0.5 rounded">
                        Proposed Schedule Shift (Pending Caregiver Approval in Approvals Panel)
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Findings & Alternative Explanations */}
              {findings && findings.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-[#5c4535]">Clinical Observations</h4>
                  {findings.map((f, i) => (
                    <div key={i} className={`p-3 rounded-lg border text-xs ${
                      f.hasAlternativeCause ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}>
                      <div className="font-semibold">{f.observedChange}</div>
                      <div className="mt-1 text-[11px] opacity-90">
                        {f.hasAlternativeCause ? `ℹ️ Explained: ${f.explanation}` : `⚠️ Alert: ${f.explanation}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Doctor Report Summary */}
              {review.doctorReportSummary && (
                <details className="text-xs text-[#8a7560]">
                  <summary className="cursor-pointer hover:text-[#5c4535] font-semibold">
                    View Doctor Summary Text
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] bg-white p-3 rounded-lg border border-[#e8dcc8]">
                    {review.doctorReportSummary}
                  </pre>
                </details>
              )}

              {/* Caregiver Feedback */}
              <div className="flex items-center justify-between text-xs pt-2 border-t border-[#e8dcc8]">
                <span className="text-[#8a7560]">Was this review accurate?</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleFeedback(review._id, true)}
                    className={`px-3 py-1 rounded-lg border transition-colors ${
                      review.caregiverFeedback?.markedAccurate === true
                        ? 'bg-[#c8d9c4] text-[#2a4a28] border-green-300 font-bold'
                        : 'bg-white text-[#2d2418] border-[#e8dcc8] hover:bg-[#fdf8f0]'
                    }`}
                  >
                    ✓ Accurate
                  </button>
                  <button
                    onClick={() => handleFeedback(review._id, false)}
                    className={`px-3 py-1 rounded-lg border transition-colors ${
                      review.caregiverFeedback?.markedAccurate === false
                        ? 'bg-[#f7ddd4] text-[#7a2a1a] border-red-300 font-bold'
                        : 'bg-white text-[#2d2418] border-[#e8dcc8] hover:bg-[#fdf8f0]'
                    }`}
                  >
                    ✗ Inaccurate
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
