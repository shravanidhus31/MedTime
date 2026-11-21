import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import api from '../utils/api';

export default function CaregiverAccessPage() {
  const { user } = useSelector((state) => state.auth);
  const navigate = useNavigate();

  const [patients, setPatients] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [accessList, setAccessList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState(null);

  // If user is caregiver, fetch their linked patients so they can switch between them
  useEffect(() => {
    const init = async () => {
      if (user?.role === 'caregiver') {
        try {
          const res = await api.get('/caregiver/dashboard');
          setPatients(res.data);
          if (res.data.length > 0) {
            setSelectedPatientId(res.data[0].patientId);
          } else {
            setIsLoading(false);
          }
        } catch (err) {
          console.error('Failed to load caregiver dashboard:', err);
          setIsLoading(false);
        }
      } else {
        // Patient directly manages their own access
        fetchAccess();
      }
    };
    init();
  }, [user]);

  const fetchAccess = async (patientId = selectedPatientId) => {
    setIsLoading(true);
    try {
      const url = patientId ? `/caregiver/access?patient=${patientId}` : '/caregiver/access';
      const res = await api.get(url);
      setAccessList(res.data);
    } catch (err) {
      console.error('Failed to fetch access list:', err);
      setActionMessage({ type: 'error', text: err.response?.data?.message || 'Failed to load access list.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPatientId) {
      fetchAccess(selectedPatientId);
    }
  }, [selectedPatientId]);

  const handleApprove = async (accessId) => {
    setActionMessage(null);
    try {
      const res = await api.post(`/caregiver/access/${accessId}/approve`);
      setActionMessage({ type: 'success', text: res.data.message || 'Access approved.' });
      fetchAccess();
    } catch (err) {
      setActionMessage({ type: 'error', text: err.response?.data?.message || 'Approval failed.' });
    }
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleRevoke = async (accessId) => {
    if (!window.confirm('Are you sure you want to revoke this caregiver’s access? This takes effect immediately.')) {
      return;
    }
    setActionMessage(null);
    try {
      const res = await api.post(`/caregiver/access/${accessId}/revoke`);
      setActionMessage({ type: 'success', text: res.data.message || 'Access revoked immediately.' });
      fetchAccess();
    } catch (err) {
      setActionMessage({ type: 'error', text: err.response?.data?.message || 'Revocation failed.' });
    }
    setTimeout(() => setActionMessage(null), 4000);
  };

  const pendingLinks = accessList.filter((a) => a.status === 'pending');
  const activeLinks = accessList.filter((a) => a.status === 'active');
  const revokedLinks = accessList.filter((a) => a.status === 'revoked');

  const backLink = user?.role === 'patient' ? '/patient' : '/caregiver';

  return (
    <div className="min-h-screen bg-[#fdf8f0] text-[#2d2418] pb-12 font-sans" style={{ fontFamily: "'Nunito', sans-serif" }}>
      {/* Top Nav */}
      <nav className="bg-white border-b-[1.5px] border-[#e8dcc8] px-8 h-[68px] flex items-center justify-between shadow-[0_2px_12px_rgba(90,60,30,0.06)]">
        <div className="flex items-center gap-3">
          <Link to={backLink} className="w-10 h-10 bg-gradient-to-br from-[#f2c4b5] to-[#dbd3ef] rounded-[10px] flex items-center justify-center text-xl">
            💊
          </Link>
          <span className="text-xl text-[#5c4535] font-medium" style={{ fontFamily: "'Lora', serif" }}>
            MedTime Care
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to={backLink}
            className="text-sm font-bold text-[#5c4535] px-4 py-2 rounded-xl border border-[#e8dcc8] hover:bg-[#f5ede0] transition-colors"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </nav>

      <div className="max-w-[960px] mx-auto px-6 mt-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#5c4535] mb-2" style={{ fontFamily: "'Lora', serif" }}>
            Caregiver Access Management
          </h1>
          <p className="text-[#8a7560]">
            Review, approve, or revoke caregiver access permissions. Revocations take effect immediately.
          </p>
        </div>

        {/* Patient Switcher for Caregivers */}
        {user?.role === 'caregiver' && patients.length > 1 && (
          <div className="flex gap-3 mb-6 overflow-x-auto pb-2">
            {patients.map((p) => (
              <button
                key={p.patientId}
                onClick={() => setSelectedPatientId(p.patientId)}
                className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all border-[1.5px] whitespace-nowrap ${
                  selectedPatientId === p.patientId
                    ? 'bg-[#5c4535] text-white border-[#5c4535]'
                    : 'bg-white text-[#8a7560] border-[#e8dcc8] hover:bg-[#f5ede0]'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {actionMessage && (
          <div
            className={`p-4 rounded-xl text-sm font-bold mb-6 border ${
              actionMessage.type === 'success'
                ? 'bg-green-50 text-green-800 border-green-200'
                : 'bg-red-50 text-red-800 border-red-200'
            }`}
          >
            {actionMessage.text}
          </div>
        )}

        {/* ─── SECTION 1: Pending Access Requests ─── */}
        <div className="bg-white rounded-[20px] p-6 border-[1.5px] border-[#e8dcc8] shadow-[0_2px_16px_rgba(90,60,30,0.08)] mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-[#5c4535]" style={{ fontFamily: "'Lora', serif" }}>
              Pending Requests
            </h2>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
              {pendingLinks.length} Waiting
            </span>
          </div>

          {isLoading ? (
            <p className="text-sm text-[#8a7560]">Loading requests...</p>
          ) : pendingLinks.length === 0 ? (
            <div className="py-6 text-center text-sm text-[#8a7560]">
              No pending caregiver link requests at this time.
            </div>
          ) : (
            <div className="space-y-4">
              {pendingLinks.map((item) => (
                <div
                  key={item._id}
                  className="p-5 bg-amber-50/50 rounded-xl border border-amber-200 flex items-center justify-between flex-wrap gap-4"
                >
                  <div>
                    <div className="font-bold text-gray-900 text-base">{item.user?.name || 'Caregiver'}</div>
                    <div className="text-sm text-gray-600 mt-1">
                      Phone: <span className="font-medium">{item.user?.phone || '—'}</span> · Requested Role:{' '}
                      <span className="font-bold capitalize text-[#5c4535]">{item.role}</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Requested on {new Date(item.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleApprove(item._id)}
                      className="px-5 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors shadow-sm"
                    >
                      ✓ Approve Access
                    </button>
                    <button
                      onClick={() => handleRevoke(item._id)}
                      className="px-4 py-2.5 bg-white text-red-600 border border-red-200 rounded-xl text-sm font-bold hover:bg-red-50 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── SECTION 2: Active Caregivers ─── */}
        <div className="bg-white rounded-[20px] p-6 border-[1.5px] border-[#e8dcc8] shadow-[0_2px_16px_rgba(90,60,30,0.08)] mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-[#5c4535]" style={{ fontFamily: "'Lora', serif" }}>
              Active Caregivers & Permissions
            </h2>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-800 border border-green-200">
              {activeLinks.length} Active
            </span>
          </div>

          {isLoading ? (
            <p className="text-sm text-[#8a7560]">Loading caregivers...</p>
          ) : activeLinks.length === 0 ? (
            <div className="py-6 text-center text-sm text-[#8a7560]">
              No active caregivers linked yet.
            </div>
          ) : (
            <div className="divide-y divide-[#f5ede0]">
              {activeLinks.map((item) => (
                <div key={item._id} className="py-4 flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-base">{item.user?.name || 'Caregiver'}</span>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#f5ede0] text-[#5c4535] border border-[#e8dcc8] capitalize">
                        {item.role}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Phone: {item.user?.phone || '—'} · Approved on{' '}
                      {item.approvedAt ? new Date(item.approvedAt).toLocaleDateString() : '—'}
                    </div>
                  </div>

                  {item.role !== 'primary' && (
                    <button
                      onClick={() => handleRevoke(item._id)}
                      className="px-4 py-2 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition-colors"
                    >
                      Revoke Access
                    </button>
                  )}
                  {item.role === 'primary' && (
                    <span className="text-xs font-bold text-gray-400 italic">Primary Caregiver</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ─── SECTION 3: Revoked Access History ─── */}
        {revokedLinks.length > 0 && (
          <div className="bg-white rounded-[20px] p-6 border-[1.5px] border-[#e8dcc8] shadow-[0_2px_16px_rgba(90,60,30,0.08)]">
            <h2 className="text-lg font-bold text-[#8a7560] mb-3" style={{ fontFamily: "'Lora', serif" }}>
              Revoked Caregivers (Audit History)
            </h2>
            <div className="divide-y divide-[#f5ede0]">
              {revokedLinks.map((item) => (
                <div key={item._id} className="py-3 flex items-center justify-between text-xs text-gray-500">
                  <div>
                    <span className="font-semibold text-gray-700">{item.user?.name || 'Caregiver'}</span> ({item.user?.phone || '—'}) · Former Role: {item.role}
                  </div>
                  <div>
                    Revoked on {item.revokedAt ? new Date(item.revokedAt).toLocaleDateString() : '—'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
