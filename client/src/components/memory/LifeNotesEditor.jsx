import React, { useState, useEffect } from 'react';
import api from '../../utils/api';
import { NotebookPen } from 'lucide-react';

/**
 * LifeNotesEditor — Feature 7 (B9: Memory Graph)
 *
 * Allows family caregivers to manage the patient's memory graph:
 * - Biographical context (People, Places, Routines, Events)
 * - Sensitive topic instructions ("How should we answer questions about deceased relatives or repetitive worries")
 * - Review and approve agent-extracted observations before they enter long-term memory.
 */
export default function LifeNotesEditor({ patientId }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedKind, setSelectedKind] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    kind: 'topic_answer',
    title: '',
    text: '',
    linkedRecordingId: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchNotes = async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const url = selectedKind === 'all'
        ? `/life-notes?patient=${patientId}`
        : `/life-notes?patient=${patientId}&kind=${selectedKind}`;
      const res = await api.get(url);
      setNotes(res.data.data || []);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load life notes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
  }, [patientId, selectedKind]);

  const handleCreateNote = async (e) => {
    e.preventDefault();
    if (!formData.title || !formData.text) return;

    setSubmitting(true);
    try {
      await api.post('/life-notes', {
        patientId,
        ...formData,
        approved: true, // Caregiver notes start approved
      });
      setShowModal(false);
      setFormData({
        kind: 'topic_answer',
        title: '',
        text: '',
        linkedRecordingId: '',
      });
      await fetchNotes();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to save life note');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveNote = async (noteId) => {
    try {
      await api.patch(`/life-notes/${noteId}/approve`);
      setNotes((prev) =>
        prev.map((n) => (n._id === noteId ? { ...n, approved: true } : n))
      );
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to approve note');
    }
  };

  const handleDeleteNote = async (noteId) => {
    if (!window.confirm('Are you sure you want to delete this memory note?')) return;
    try {
      await api.delete(`/life-notes/${noteId}`);
      setNotes((prev) => prev.filter((n) => n._id !== noteId));
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to delete note');
    }
  };

  const kinds = [
    { id: 'all', label: 'All Notes', icon: '' },
    { id: 'topic_answer', label: 'Sensitive Topics ("How to answer")', icon: '' },
    { id: 'person', label: 'People & Family', icon: '' },
    { id: 'place', label: 'Places & Home', icon: '' },
    { id: 'routine', label: 'Daily Routines', icon: '' },
    { id: 'event', label: 'Life Events', icon: '' },
  ];

  const filteredNotes = notes.filter((n) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q);
  });

  return (
    <div className="bg-white rounded-[24px] p-6 border-[1.5px] border-[#e2e9e5] shadow-[0_2px_16px_rgba(20,45,38,0.08)] mb-8">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#e6eee9]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#eaf3ee] text-[#2f6f5e] flex items-center justify-center font-bold text-xl border border-[#e2e9e5]"><NotebookPen size={18} /></div>
          <div>
            <h3 className="text-xl font-bold text-[#1c2b26]">Patient Memory Graph & Life Notes</h3>
            <p className="text-xs text-[#66756f]">
              Personal context and comforting phrasing used by the AI voice agent during check-ins and call-ins.
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 text-xs font-bold rounded-xl bg-[#2f6f5e] text-white hover:bg-[#255a4c] transition-colors shadow-sm flex items-center gap-2"
        >
          <span>＋</span> Add Memory Note
        </button>
      </div>

      {/* Filter Tabs & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-5">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 max-w-full">
          {kinds.map((k) => (
            <button
              key={k.id}
              onClick={() => setSelectedKind(k.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border ${
                selectedKind === k.id
                  ? 'bg-[#2f6f5e] text-white border-[#2f6f5e]'
                  : 'bg-white text-[#66756f] border-[#e2e9e5] hover:bg-[#f8faf9]'
              }`}
            >
              <span className="mr-1">{k.icon}</span> {k.label}
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64">
          <input
            type="text"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-1.5 text-xs rounded-xl border border-[#e2e9e5] bg-[#f8faf9] focus:outline-none focus:border-[#2f6f5e]"
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Notes Grid */}
      <div className="mt-6">
        {loading ? (
          <div className="py-8 text-center text-xs text-[#66756f]">Loading memory notes...</div>
        ) : filteredNotes.length === 0 ? (
          <div className="py-10 text-center bg-[#f8faf9] rounded-xl border border-dashed border-[#e2e9e5]">
            <p className="text-sm font-semibold text-[#66756f]">No notes found in this category</p>
            <p className="text-xs text-[#93a59e] mt-1">
              Add family stories, routines, or answering guidelines to help the agent communicate smoothly.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredNotes.map((note) => {
              const kindObj = kinds.find((k) => k.id === note.kind);
              return (
                <div
                  key={note._id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col justify-between ${
                    note.approved
                      ? 'bg-white border-[#e2e9e5] hover:shadow-sm'
                      : 'bg-amber-50/70 border-amber-300 shadow-sm'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#f6f9f7] text-[#2f6f5e] border border-[#e2e9e5] flex items-center gap-1">
                        <span>{kindObj?.icon || ''}</span> {kindObj?.label || note.kind}
                      </span>
                      {note.approved ? (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          ✓ Verified
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full animate-pulse">
                          Pending Approval
                        </span>
                      )}
                    </div>

                    <h4 className="font-bold text-sm text-[#1c2b26] mb-1.5">{note.title}</h4>
                    <p className="text-xs text-[#2f6f5e] leading-relaxed whitespace-pre-wrap">{note.text}</p>
                  </div>

                  <div className="flex items-center justify-between pt-3 mt-3 border-t border-[#e6eee9] text-[11px] text-[#66756f]">
                    <span>By: {note.writtenBy?.name || 'Caregiver'}</span>
                    <div className="flex items-center gap-2">
                      {!note.approved && (
                        <button
                          onClick={() => handleApproveNote(note._id)}
                          className="px-2.5 py-1 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 transition-colors"
                        >
                          Approve
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteNote(note._id)}
                        className="text-red-500 hover:text-red-700 px-2 py-1 font-semibold"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Note Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-[#e2e9e5] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[#e6eee9]">
              <h3 className="text-lg font-bold text-[#1c2b26]">Add Memory Note</h3>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNote} className="space-y-4 mt-4">
              <div>
                <label className="block text-xs font-bold text-[#2f6f5e] mb-1">Category</label>
                <select
                  value={formData.kind}
                  onChange={(e) => setFormData({ ...formData, kind: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-[#e2e9e5] bg-white focus:outline-none focus:border-[#2f6f5e]"
                >
                  <option value="topic_answer">Sensitive Topic (&quot;How should we answer questions about...&quot;)</option>
                  <option value="person">Person / Family Member</option>
                  <option value="place">Place / Familiar Surroundings</option>
                  <option value="routine">Daily Habit or Routine</option>
                  <option value="event">Memorable Life Event</option>
                </select>
                {formData.kind === 'topic_answer' && (
                  <p className="text-[11px] text-[#66756f] mt-1 italic">
                    Example: When Grandma repeatedly asks about her late husband, instruct the agent how to answer kindly without causing distress.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2f6f5e] mb-1">Title / Topic Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Questions about Grandpa, Morning Walk Routine, etc."
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e9e5] bg-white focus:outline-none focus:border-[#2f6f5e]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2f6f5e] mb-1">
                  {formData.kind === 'topic_answer' ? 'Approved Answer Wording' : 'Context / Instructions'}
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder={
                    formData.kind === 'topic_answer'
                      ? 'e.g. "Grandpa is resting peacefully. We are so lucky to have his memories. Why don\'t we have a cup of warm chai together?"'
                      : 'Provide details that help the AI speak familiarly to the patient.'
                  }
                  value={formData.text}
                  onChange={(e) => setFormData({ ...formData, text: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e9e5] bg-white focus:outline-none focus:border-[#2f6f5e]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#2f6f5e] mb-1">
                  Optional Linked Voice Clip ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. clip_daughter_morning_greeting"
                  value={formData.linkedRecordingId}
                  onChange={(e) => setFormData({ ...formData, linkedRecordingId: e.target.value })}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#e2e9e5] bg-white focus:outline-none focus:border-[#2f6f5e]"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#e6eee9]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs font-bold rounded-xl border border-[#e2e9e5] text-[#66756f] hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-[#2f6f5e] text-white hover:bg-[#255a4c] transition-colors disabled:opacity-50"
                >
                  {submitting ? 'Saving...' : 'Save Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
