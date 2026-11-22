import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { HelpCircle } from 'lucide-react';

export default function QuestionsPanel({ patientId, onUpdate }) {
  const [questions, setQuestions] = useState([]);
  const [customAnswers, setCustomAnswers] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  const fetchQuestions = async () => {
    if (!patientId) return;
    setIsLoading(true);
    try {
      const res = await api.get(`/agent/questions?patient=${patientId}&status=pending`);
      setQuestions(res.data);
      if (onUpdate) onUpdate(res.data.length);
    } catch (err) {
      console.error('Failed to fetch agent questions:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchQuestions();
  }, [patientId]);

  const handleAnswer = async (id, answerText) => {
    if (!answerText) return;
    try {
      await api.post(`/agent/questions/${id}/answer`, { answer: answerText });
      fetchQuestions();
    } catch (err) {
      console.error('Failed to answer question:', err);
    }
  };

  if (isLoading && questions.length === 0) return null;
  if (questions.length === 0) return null;

  return (
    <div className="bg-white rounded-[20px] p-6 border-[1.5px] border-[#e2e9e5] shadow-[0_2px_16px_rgba(20,45,38,0.08)] mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-full bg-[#e3f2ea] text-[#2f6f5e] flex items-center justify-center shrink-0"><HelpCircle size={18} /></span>
          <div>
            <h2 className="text-xl font-bold text-[#2f6f5e]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              Questions from the AI Care Agent
            </h2>
            <p className="text-xs text-[#66756f]">
              The agent needs clarification before continuing its workflow (CHI 2025).
            </p>
          </div>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
          {questions.length} Waiting
        </span>
      </div>

      <div className="space-y-4">
        {questions.map((q) => (
          <div key={q._id} className="p-5 rounded-xl border border-blue-100 bg-blue-50/40 space-y-3">
            <div className="font-bold text-gray-900 text-sm">
              "{q.question}"
            </div>

            {/* Quick Choice Buttons */}
            {q.choices && q.choices.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {q.choices.map((choice, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAnswer(q._id, choice)}
                    className="px-4 py-2 bg-white hover:bg-blue-600 hover:text-white border border-blue-300 rounded-xl text-xs font-bold text-blue-700 transition-colors shadow-sm"
                  >
                    {choice}
                  </button>
                ))}
              </div>
            )}

            {/* Custom Input fallback */}
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                placeholder="Or type custom answer..."
                value={customAnswers[q._id] || ''}
                onChange={(e) =>
                  setCustomAnswers({ ...customAnswers, [q._id]: e.target.value })
                }
                className="flex-1 text-xs px-3.5 py-2 bg-white border border-gray-200 rounded-xl outline-none focus:border-blue-500"
              />
              <button
                onClick={() => handleAnswer(q._id, customAnswers[q._id])}
                disabled={!customAnswers[q._id]}
                className="px-4 py-2 bg-blue-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors"
              >
                Reply
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
