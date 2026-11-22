import React, { useState } from 'react';
import api from '../../utils/api';

/**
 * CaregiverCopilotPanel — B15 (Feature 2: RAG-Assisted Caregiver Copilot)
 *
 * Implements 4-mode empathetic & clinical copilot:
 * - Inform: Clinical guidance from NICE and Alzheimer's Association
 * - Coach: Step-by-step techniques for challenging moments
 * - Relate: Normalization of caregiver burden
 * - Listen: Emotional support, helpline resources, non-judgmental presence
 *
 * Enforces zero dosing advice and displays source citations.
 */

const QUICK_PROMPTS = [
  'He refuses to take his evening bath, what should I do?',
  'I feel so exhausted and overwhelmed today.',
  'What should I do when he repeats the same question?',
  'How do we manage late afternoon sundowning agitation?',
];

const MODES = [
  { id: '', label: 'Auto-Detect' },
  { id: 'inform', label: 'Inform' },
  { id: 'coach', label: 'Coach' },
  { id: 'relate', label: 'Relate' },
  { id: 'listen', label: 'Listen' },
];

export default function CaregiverCopilotPanel({ patientId }) {
  const [messages, setMessages] = useState([
    {
      sender: 'copilot',
      mode: 'inform',
      text: "Hello! I am your Caregiver Copilot. I can offer step-by-step coaching for difficult moments, evidence-based guidance from dementia care frameworks, or simply a listening ear when things feel overwhelming. How can I support you right now?",
      citations: [{ title: 'Dementia Care Guidelines', source: 'NICE [NG97] / Alzheimer\'s Association' }],
    },
  ]);
  const [input, setInput] = useState('');
  const [selectedMode, setSelectedMode] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async (textToSend) => {
    const text = textToSend || input;
    if (!text.trim() || loading) return;

    const userMsg = { sender: 'user', text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.post('/copilot/ask', {
        message: text,
        mode: selectedMode || undefined,
        patientId,
      });

      const data = res.data?.data || {};
      const botMsg = {
        sender: 'copilot',
        mode: data.mode || 'inform',
        text: data.reply,
        citations: data.citations || [],
        proposedAction: data.proposedAction,
        released: data.released !== false,
        reviews: data.reviews || null,
        source: data.source,
        urgent: data.urgent,
      };

      setMessages(prev => [...prev, botMsg]);
    } catch (err) {
      setMessages(prev => [
        ...prev,
        {
          sender: 'copilot',
          mode: 'inform',
          text: err?.response?.data?.message || 'Sorry, I encountered a temporary connection issue. Please try again.',
          citations: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const getModeBadge = (mode) => {
    switch (mode) {
      case 'listen':
        return <span className="bg-purple-100 text-purple-800 text-[11px] font-bold px-2.5 py-0.5 rounded-full">Listen (Emotional Support)</span>;
      case 'coach':
        return <span className="bg-blue-100 text-blue-800 text-[11px] font-bold px-2.5 py-0.5 rounded-full">Coach (Step-by-Step)</span>;
      case 'relate':
        return <span className="bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2.5 py-0.5 rounded-full">Relate (Shared Experience)</span>;
      default:
        return <span className="bg-[#eaf3ee] text-[#2f6f5e] text-[11px] font-bold px-2.5 py-0.5 rounded-full">Inform (Clinical Guidance)</span>;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#e2e9e5] p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-[#1c2b26]">Caregiver Copilot</h2>
          <p className="text-xs text-[#66756f] mt-0.5">
            Dementia care guidance, behavioral coaching, and compassionate caregiver support
          </p>
        </div>
        <span className="text-[11px] bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1 rounded-full font-semibold">
          CareGuardAI: Safe (No Dosing Advice)
        </span>
      </div>

      {/* Mode Selector Tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {MODES.map(m => (
          <button
            key={m.id}
            onClick={() => setSelectedMode(m.id)}
            className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${
              selectedMode === m.id
                ? 'bg-[#2f6f5e] text-white shadow-sm'
                : 'bg-[#f7faf8] text-[#66756f] hover:bg-[#eaf3ee]'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Quick Prompt Chips */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {QUICK_PROMPTS.map((prompt, i) => (
          <button
            key={i}
            onClick={() => sendMessage(prompt)}
            className="text-[11px] bg-[#f4f7f5] border border-[#e2e9e5] text-[#2f6f5e] px-3 py-1.5 rounded-full hover:bg-[#eaf3ee] whitespace-nowrap transition-colors flex-shrink-0"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Chat Messages */}
      <div className="space-y-4 max-h-[380px] overflow-y-auto pr-1">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl p-4 text-xs leading-relaxed ${
                m.sender === 'user'
                  ? 'bg-[#2f6f5e] text-white'
                  : 'bg-[#f7faf8] border border-[#e2e9e5] text-[#1c2b26]'
              }`}
            >
              {m.sender === 'copilot' && (
                <div className="mb-2 flex items-center justify-between gap-2">
                  {getModeBadge(m.mode)}
                </div>
              )}
              <div className={`whitespace-pre-line ${m.urgent ? 'font-semibold text-[#a23b32]' : ''}`}>{m.text}</div>

              {/* fix 9: how the answer was checked before it was shown */}
              {m.sender === 'copilot' && m.reviews && (
                <div className="mt-2 text-[10px] text-[#66756f]">
                  {m.reviews.safety && m.reviews.grounding
                    ? `${m.released ? '✓ Checked before showing' : '✗ Not shown: failed the checks'} · safety risk ${m.reviews.safety.score}/5 · made-up facts risk ${m.reviews.grounding.score}/5`
                    : m.reviews.note === 'basic answer (model unavailable)'
                      ? 'Basic answer from the guidance library and her records (the assistant is busy right now).'
                      : m.reviews.note === 'fixed safety reply' ? 'A fixed safety reply.' : ''}
                </div>
              )}

              {/* Citations */}
              {m.citations && m.citations.length > 0 && (
                <div className="mt-3 pt-2 border-t border-[#e2e9e5] text-[10px] text-[#66756f] flex flex-wrap gap-1.5 items-center">
                  <span className="font-bold">Sources:</span>
                  {m.citations.map((c, ci) => (
                    <span key={ci} className="bg-white border border-[#e2e9e5] px-2 py-0.5 rounded font-mono">
                      {c.source || c.title}
                    </span>
                  ))}
                </div>
              )}

              {/* Proposed Action */}
              {m.proposedAction && (
                <div className="mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px]">
                  <strong>For the doctor:</strong> {m.proposedAction.question || m.proposedAction.description}
                  <div className="mt-1 text-[#2f6f5e]">Write this down to ask at her next visit.</div>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-[#66756f] bg-[#f7faf8] p-3 rounded-xl border border-[#e2e9e5] w-fit">
            <span className="animate-spin"></span> Consulting dementia care guidance…
          </div>
        )}
      </div>

      {/* Input Field */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about behavioral challenges, evening sundowning, caregiver burnout..."
          className="flex-1 border border-[#e2e9e5] rounded-xl px-4 py-2.5 text-xs text-[#1c2b26] focus:outline-none focus:ring-2 focus:ring-[#9fb5ad]"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="bg-[#2f6f5e] text-white px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-[#255a4c] disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </form>
    </div>
  );
}
