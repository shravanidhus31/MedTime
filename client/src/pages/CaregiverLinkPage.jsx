import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import api from '../utils/api';

export default function CaregiverLinkPage() {
  const { user } = useSelector((state) => state.auth);
  const navigate = useNavigate();

  const [patientPhone, setPatientPhone] = useState('');
  const [role, setRole] = useState('view');
  const [requests, setRequests] = useState([]);
  const [message, setMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);

  const fetchMyRequests = async () => {
    try {
      const res = await api.get('/caregiver/my-requests');
      setRequests(res.data);
    } catch (err) {
      console.error('Failed to fetch link requests:', err);
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    fetchMyRequests();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setIsLoading(true);

    try {
      const res = await api.post('/caregiver/link', { patientPhone, role });
      setMessage({ type: 'success', text: res.data.message });
      setPatientPhone('');
      setRole('view');
      fetchMyRequests();
    } catch (err) {
      setMessage({
        type: 'error',
        text: err.response?.data?.message || 'Failed to submit link request.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fdf8f0] text-[#2d2418] pb-12 font-sans" style={{ fontFamily: "'Nunito', sans-serif" }}>
      {/* Top Navigation */}
      <nav className="bg-white border-b-[1.5px] border-[#e8dcc8] px-8 h-[68px] flex items-center justify-between shadow-[0_2px_12px_rgba(90,60,30,0.06)]">
        <div className="flex items-center gap-3">
          <Link to="/caregiver" className="w-10 h-10 bg-gradient-to-br from-[#f2c4b5] to-[#dbd3ef] rounded-[10px] flex items-center justify-center text-xl">
            💊
          </Link>
          <span className="text-xl text-[#5c4535] font-medium" style={{ fontFamily: "'Lora', serif" }}>
            MedTime Care
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/caregiver"
            className="text-sm font-bold text-[#5c4535] px-4 py-2 rounded-xl border border-[#e8dcc8] hover:bg-[#f5ede0] transition-colors"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </nav>

      <div className="max-w-[860px] mx-auto px-6 mt-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#5c4535] mb-2" style={{ fontFamily: "'Lora', serif" }}>
            Request Patient Link
          </h1>
          <p className="text-[#8a7560]">
            Submit a link request to monitor or care for a family member. For patient privacy, links remain pending until approved by the patient or their primary caregiver.
          </p>
        </div>

        {/* Request Form Card */}
        <div className="bg-white rounded-[20px] p-8 border-[1.5px] border-[#e8dcc8] shadow-[0_2px_16px_rgba(90,60,30,0.08)] mb-8">
          <h2 className="text-xl font-bold text-[#5c4535] mb-4" style={{ fontFamily: "'Lora', serif" }}>
            New Link Request
          </h2>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-[#5c4535] mb-1">
                Patient's Registered Phone Number
              </label>
              <input
                type="tel"
                required
                value={patientPhone}
                onChange={(e) => setPatientPhone(e.target.value)}
                placeholder="e.g. 9876543210"
                className="w-full px-4 py-3 bg-white border-[1.5px] border-[#e8dcc8] rounded-xl outline-none focus:border-[#5c4535] transition-colors text-gray-800"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-[#5c4535] mb-1">
                Requested Access Level
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => setRole('view')}
                  className={`p-4 rounded-xl border-[1.5px] text-left transition-all ${
                    role === 'view'
                      ? 'bg-[#f5ede0] border-[#5c4535] text-[#5c4535]'
                      : 'bg-white border-[#e8dcc8] text-[#8a7560] hover:bg-gray-50'
                  }`}
                >
                  <div className="font-bold text-sm mb-1">View Access</div>
                  <div className="text-xs text-[#8a7560]">Read dose history, alerts and active medications.</div>
                </button>

                <button
                  type="button"
                  onClick={() => setRole('approve')}
                  className={`p-4 rounded-xl border-[1.5px] text-left transition-all ${
                    role === 'approve'
                      ? 'bg-[#f5ede0] border-[#5c4535] text-[#5c4535]'
                      : 'bg-white border-[#e8dcc8] text-[#8a7560] hover:bg-gray-50'
                  }`}
                >
                  <div className="font-bold text-sm mb-1">Approve Access</div>
                  <div className="text-xs text-[#8a7560]">Edit medications and approve agent schedule proposals.</div>
                </button>

                <button
                  type="button"
                  onClick={() => setRole('doctor')}
                  className={`p-4 rounded-xl border-[1.5px] text-left transition-all ${
                    role === 'doctor'
                      ? 'bg-[#f5ede0] border-[#5c4535] text-[#5c4535]'
                      : 'bg-white border-[#e8dcc8] text-[#8a7560] hover:bg-gray-50'
                  }`}
                >
                  <div className="font-bold text-sm mb-1">Doctor Access</div>
                  <div className="text-xs text-[#8a7560]">Clinical Level-2 approvals and monthly medical reports.</div>
                </button>
              </div>
            </div>

            {message && (
              <div
                className={`p-4 rounded-xl text-sm font-medium border ${
                  message.type === 'success'
                    ? 'bg-green-50 text-green-800 border-green-200'
                    : 'bg-red-50 text-red-800 border-red-200'
                }`}
              >
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="bg-[#5c4535] text-white px-8 py-3.5 rounded-xl font-bold hover:bg-[#4a3628] transition-colors border-[1.5px] border-[#5c4535] disabled:opacity-50"
            >
              {isLoading ? 'Submitting request...' : 'Submit Link Request'}
            </button>
          </form>
        </div>

        {/* Existing Link Requests List */}
        <div className="bg-white rounded-[20px] p-8 border-[1.5px] border-[#e8dcc8] shadow-[0_2px_16px_rgba(90,60,30,0.08)]">
          <h2 className="text-xl font-bold text-[#5c4535] mb-4" style={{ fontFamily: "'Lora', serif" }}>
            My Link Requests
          </h2>

          {isFetching ? (
            <p className="text-sm text-[#8a7560]">Loading your link requests...</p>
          ) : requests.length === 0 ? (
            <div className="text-center py-8 text-[#8a7560]">
              You haven't requested links to any patients yet. Use the form above to get started.
            </div>
          ) : (
            <div className="divide-y divide-[#f5ede0]">
              {requests.map((req) => {
                const patientName = req.patient?.user?.name || 'Patient';
                const patientPhone = req.patient?.user?.phone || '—';
                const dateStr = new Date(req.createdAt).toLocaleDateString();

                return (
                  <div key={req._id} className="py-4 flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <div className="font-bold text-gray-900">{patientName}</div>
                      <div className="text-xs text-gray-500">
                        Phone: {patientPhone} · Role: <span className="font-semibold capitalize">{req.role}</span> · Requested on {dateStr}
                      </div>
                    </div>
                    <div>
                      {req.status === 'pending' && (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          ⏳ Pending Approval
                        </span>
                      )}
                      {req.status === 'active' && (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-200">
                          ✅ Active
                        </span>
                      )}
                      {req.status === 'revoked' && (
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200">
                          🚫 Revoked
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
