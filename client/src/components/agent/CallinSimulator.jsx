import React, { useState } from 'react';
import api from '../../utils/api';
import { PhoneIncoming } from 'lucide-react';

/**
 * CallinSimulator — B11 (Feature 7: "Did I take my pills?" Call-In Agent)
 *
 * Interactive simulator for patient call-in interactions:
 * - Doses query ("Did I take my morning pills?")
 * - Memory query ("Who is Priya?")
 * - Routine query ("What is my morning schedule?")
 * - Safety guards (double-dose prevention, financial red flags)
 */
export default function CallinSimulator({ patientId }) {
  const [messages, setMessages] = useState([
    {
      role: 'agent',
      text: 'Hello! This is MedTime. What would you like to know today?',
      time: 'Just now',
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const quickPrompts = [
    'Did I take my morning pills?',
    'Who is Priya?',
    'Can I take another pill right now?',
    'What is my morning routine?',
  ];

  const handleSend = async (queryToSend) => {
    const query = queryToSend || inputQuery;
    if (!query || !query.trim() || !patientId) return;

    setError(null);
    const userMsg = {
      role: 'patient',
      text: query.trim(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    setLoading(true);

    try {
      const res = await api.post('/voice/text-simulate', {
        patientId,
        question: query.trim(),
        sessionId,
      });

      const { reply, sessionId: newSessionId, action, source, done } = res.data;
      if (newSessionId) setSessionId(newSessionId);

      const agentMsg = {
        role: 'agent',
        text: reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        action,
        source,
        done,
      };

      setMessages((prev) => [...prev, agentMsg]);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to simulate call-in turn');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setMessages([
      {
        role: 'agent',
        text: 'Hello! This is MedTime. What would you like to know today?',
        time: 'Just now',
      },
    ]);
    setSessionId(null);
    setError(null);
  };

  return (
    <div className="bg-white rounded-[24px] p-6 border-[1.5px] border-[#e2e9e5] shadow-[0_2px_16px_rgba(20,45,38,0.08)] mb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#e6eee9]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#eef7f2] text-[#2e7d32] flex items-center justify-center font-bold text-xl border border-[#c8e6c9]"><PhoneIncoming size={18} /></div>
          <div>
            <h3 className="text-xl font-bold text-[#1c2b26]">Call-In Agent Simulator (Feature 7)</h3>
            <p className="text-xs text-[#66756f]">
              Test patient inquiries (&quot;Did I take my pills?&quot;, family queries, safety checks) in text mode.
            </p>
          </div>
        </div>

        <button
          onClick={handleReset}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#e2e9e5] text-[#66756f] hover:bg-gray-50"
        >
          ↺ Reset Call
        </button>
      </div>

      {/* Quick Prompts */}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <span className="text-[11px] font-bold text-[#66756f]">Sample Questions:</span>
        {quickPrompts.map((p, idx) => (
          <button
            key={idx}
            disabled={loading}
            onClick={() => handleSend(p)}
            className="px-2.5 py-1 text-xs rounded-full bg-[#f8faf9] border border-[#e2e9e5] text-[#2f6f5e] hover:bg-[#eaf3ee] transition-colors disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Transcript Log */}
      <div className="mt-4 space-y-3 max-h-72 overflow-y-auto p-4 bg-[#f8faf9] rounded-2xl border border-[#e6eee9]">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${m.role === 'patient' ? 'items-end' : 'items-start'}`}
          >
            <div className="text-[10px] text-[#66756f] px-1 mb-0.5">
              {m.role === 'patient' ? 'Patient' : 'MedTime Agent'} • {m.time}
            </div>
            <div
              className={`max-w-[85%] p-3.5 rounded-2xl text-xs leading-relaxed ${
                m.role === 'patient'
                  ? 'bg-[#2f6f5e] text-white rounded-br-none'
                  : 'bg-white text-[#1c2b26] border border-[#e2e9e5] shadow-sm rounded-bl-none'
              }`}
            >
              <p>{m.text}</p>
              {m.action && (
                <div className="mt-2 pt-1.5 border-t border-gray-100 flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Action: {m.action.replace(/_/g, ' ')}
                  </span>
                  {m.source && (
                    <span className="text-[10px] text-[#66756f]">Source: {m.source}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="text-xs text-[#66756f] italic flex items-center gap-2">
            <span>Agent is looking up records...</span>
          </div>
        )}
      </div>

      {/* Input Field */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex gap-2 mt-4"
      >
        <input
          type="text"
          placeholder="Ask a question as the patient (e.g. 'Did I take my afternoon tablet?')..."
          value={inputQuery}
          onChange={(e) => setInputQuery(e.target.value)}
          disabled={loading}
          className="flex-1 px-4 py-2.5 text-xs rounded-xl border border-[#e2e9e5] bg-white focus:outline-none focus:border-[#2f6f5e]"
        />
        <button
          type="submit"
          disabled={loading || !inputQuery.trim()}
          className="px-5 py-2.5 text-xs font-bold rounded-xl bg-[#2f6f5e] text-white hover:bg-[#255a4c] transition-colors disabled:opacity-50"
        >
          {loading ? 'Thinking...' : 'Speak ↵'}
        </button>
      </form>
    </div>
  );
}
