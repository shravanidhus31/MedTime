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
      setMsg({ type: 'error', text: err?.response?.data?.message || err?.response?.data?.error || 'Failed to generate review.' });
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
          <h2 className="text-lg font-bold text-[#2d2418]">📊 Weekly review</h2>
          <p className="text-xs text-[#8a7560] mt-0.5">
            Changes in how her calls go, compared with her own first 4 weeks; harder evenings (sundowning)
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
            Click "Run Weekly Analysis", or wait for the automatic review on Sunday evening.
          </p>
        </div>
      ) : (
        reviews.map(review => {
          const { findings = [], summaryLines = [] } = review;
          // fix 8: the review's own plain-language lines (her baseline, 2 weeks running, checks done)
          const STYLE = {
            flag: 'bg-amber-50 border-amber-300 text-amber-900',
            checking: 'bg-sky-50 border-sky-200 text-sky-900',
            explained: 'bg-blue-50 border-blue-200 text-blue-900',
            sundowning: 'bg-orange-50 border-orange-300 text-orange-900',
            watch: 'bg-white border-[#e8dcc8] text-[#5c4535]',
            ok: 'bg-emerald-50 border-emerald-200 text-emerald-900',
            info: 'bg-white border-[#e8dcc8] text-[#8a7560]',
          };
          const ICON = { flag: '⚠️', checking: '❓', explained: 'ℹ️', sundowning: '🌅', watch: '👀', ok: '✓', info: '·' };
          return (
            <div key={review._id} className="border border-[#e8dcc8] rounded-xl p-5 space-y-4 bg-[#faf6f0]">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-[#5c4535] bg-[#f5ede0] px-3 py-1 rounded-full">
                  Week of {new Date(review.weekStartDate).toLocaleDateString('en-IN')} – {new Date(review.weekEndDate).toLocaleDateString('en-IN')}
                </span>
                <span className="text-[11px] text-[#8a7560]">Compared with her own first 4 weeks · margin {review.marginPercent || 25}%</span>
              </div>

              <div className="space-y-2">
                {summaryLines.map((l, i) => (
                  <div key={i} className={`p-3 rounded-lg border text-xs leading-relaxed ${STYLE[l.kind] || STYLE.info}`}>
                    <span className="mr-1">{ICON[l.kind] || ''}</span>{l.text}
                  </div>
                ))}
              </div>

              {/* Her own words from those calls (never invented) */}
              {findings.some((f) => f.quotes && f.quotes.length) && (
                <div className="text-xs text-[#5c4535]">
                  <div className="font-semibold mb-1">Her words on those calls</div>
                  {findings.flatMap((f) => f.quotes || []).slice(0, 4).map((q, i) => (
                    <div key={i} className="italic text-[#8a7560]">“{q}”</div>
                  ))}
                </div>
              )}
              {review.languageNotes && review.languageNotes.length > 0 && (
                <div className="text-xs text-[#5c4535]">
                  <div className="font-semibold mb-1">Noticed in how she spoke</div>
                  {review.languageNotes.map((n, i) => (
                    <div key={i}>• {n.difference} <span className="italic text-[#8a7560]">“{n.quote}”</span></div>
                  ))}
                </div>
              )}
              {review.sundowning?.proposalId && (
                <div className="text-[11px] text-orange-900">The earlier evening call is waiting for approval in <b>Proposals</b>.</div>
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
