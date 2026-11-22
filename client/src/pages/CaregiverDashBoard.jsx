import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Link, useNavigate } from 'react-router-dom';
import { logoutUser } from '../redux/authSlice';
import api from '../utils/api';
import ApprovalsPanel from '../components/approvals/ApprovalsPanel';
import QuestionsPanel from '../components/approvals/QuestionsPanel';
import ActivityPanel from '../components/agent/ActivityPanel';
import JournalPanel from '../components/journal/JournalPanel';
import LifeNotesEditor from '../components/memory/LifeNotesEditor';
import CallinSimulator from '../components/agent/CallinSimulator';
import PrescriptionReviewPanel from '../components/prescription/PrescriptionReviewPanel';
import RoutineProfileEditor from '../components/prescription/RoutineProfileEditor';
import WeeklyReviewPanel from '../components/agent/WeeklyReviewPanel';
import CaregiverCopilotPanel from '../components/agent/CaregiverCopilotPanel';
import FollowUpsPanel from '../components/agent/FollowUpsPanel';
import AttentionStrip from '../components/agent/AttentionStrip';
import CareSettings from '../components/CareSettings';
import { Card, SectionTitle } from '../components/ui';
import { HeartPulse, LayoutDashboard, CheckSquare, Activity, LineChart, MessageCircle, Settings, Users, LogOut, UserPlus } from 'lucide-react';

// Sections, as tabs in the nav bar. 'today' is the Overview (the id is kept so a remembered tab still works).
const NAV = [
  { id: 'today', label: 'Overview', icon: LayoutDashboard },
  { id: 'approvals', label: 'Approvals', icon: CheckSquare },
  { id: 'activity', label: 'Agent decisions', icon: Activity },
  { id: 'insights', label: 'Insights', icon: LineChart },
  { id: 'copilot', label: 'Copilot', icon: MessageCircle },
  { id: 'setup', label: 'Setup', icon: Settings },
];

// UI pass (22 Nov): the dashboard is tabs under a "Needs attention" strip, instead of ten panels in
// one long page. The tab is remembered on this device.
const TAB_KEY = 'medtime.caregiver.tab';
const readTab = () => { try { return localStorage.getItem(TAB_KEY) || 'today'; } catch { return 'today'; } };

export default function CaregiverDashboard() {
  const { user } = useSelector((state) => state.auth);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // State
  const [patients, setPatients] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [patientHistory, setPatientHistory] = useState([]);
  const [, setPendingApprovalsCount] = useState(0); // the panels report counts; the attention strip shows them
  const [, setPendingQuestionsCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTabState] = useState(readTab);
  const [attention, setAttention] = useState(null);
  const setTab = (t) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode */ } };

  // Link Patient State
  const [linkPhone, setLinkPhone] = useState('');
  const [linkMessage, setLinkMessage] = useState(null);

  // Date Logic: Generate the last 7 days for the top picker
  const [weekDays, setWeekDays] = useState([]);
  const [selectedDateStr, setSelectedDateStr] = useState('');

  useEffect(() => {
    // Generate the last 7 days ending in "today"
    const days = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(today.getDate() - i);
      days.push({
        dateObj: d,
        dayName: d.toLocaleDateString('en-US', { weekday: 'narrow' }), // 'M', 'T', 'W'
        dayNum: d.getDate(), // 11, 12, 13
        fullDateStr: d.toDateString() // "Wed Apr 15 2026"
      });
    }
    setWeekDays(days);
    setSelectedDateStr(days[6].fullDateStr); // Default to today (the last item)
  }, []);

  // Centralized fetch function so we can call it after linking a new patient
  const fetchCaregiverData = async () => {
    try {
      const response = await api.get('/caregiver/dashboard');
      setPatients(response.data);
      if (response.data.length > 0 && !selectedPatientId) {
        setSelectedPatientId(response.data[0].patientId); // Default select the first patient
      }
    } catch (error) {
      console.error('Failed to fetch patients:', error);
    }
  };

  // 1. Fetch Patients on Load
  useEffect(() => {
    fetchCaregiverData();
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchCaregiverData, 10000);
    return () => clearInterval(interval);
  }, [selectedPatientId]);

  // 2. Fetch History when a Patient is Selected
  useEffect(() => {
    if (!selectedPatientId) return;

    const fetchHistory = async () => {
      setIsLoading(true);
      try {
        const response = await api.get(`/caregiver/patients/${selectedPatientId}/history`);
        setPatientHistory(response.data);
      } catch (error) {
        console.error('Failed to fetch history:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchHistory();
  }, [selectedPatientId]);

  // Handle Linking a New Patient
  const handleLinkPatient = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/caregiver/link', { patientPhone: linkPhone });
      setLinkMessage({ text: res.data.message, type: 'success' });
      setLinkPhone('');
      fetchCaregiverData(); // Refresh the list immediately!
    } catch (error) {
      setLinkMessage({ text: error.response?.data?.message || 'Failed to link patient.', type: 'error' });
    }
    setTimeout(() => setLinkMessage(null), 4000);
  };

  // 3. Filter history to ONLY show the selected day
  const displayedHistory = patientHistory.filter(reminder => {
    return new Date(reminder.scheduledTime).toDateString() === selectedDateStr;
  });

  const selectedPatient = patients.find(p => p.patientId === selectedPatientId);
  const approvalsCount = attention ? attention.pendingApprovals + attention.pendingQuestions : 0;

  const linkForm = (
    <>
          <form onSubmit={handleLinkPatient} className="flex gap-3 items-center flex-wrap md:flex-nowrap">
            <input
              type="text"
              placeholder="Enter patient's registered phone number (e.g. 9876543210)"
              value={linkPhone}
              onChange={(e) => setLinkPhone(e.target.value)}
              className="flex-1 px-4 py-[13px] bg-white border-[1.5px] border-[#e2e9e5] rounded-xl outline-none focus:border-[#2f6f5e] font-sans transition-colors w-full"
              required
            />
            <button type="submit" className="bg-[#2f6f5e] text-white px-6 py-[13px] rounded-xl font-bold hover:bg-[#255a4c] transition-colors border-[1.5px] border-[#2f6f5e] w-full md:w-auto whitespace-nowrap">
              Link Patient
            </button>
          </form>
          {linkMessage && (
            <p className={`text-sm mt-3 font-bold ${linkMessage.type === 'success' ? 'text-[#7da876]' : 'text-[#e8a090]'}`}>
              {linkMessage.text}
            </p>
          )}
    </>
  );

  return (
    <div className="min-h-screen bg-[#f4f7f5] text-[#1c2b26] font-sans pb-12" >

      {/* ─── TOP NAV: every section is a tab here (UI pass, 22 Nov) ─── */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#e2e9e5]">
        <div className="max-w-[1240px] mx-auto px-4 md:px-7 h-[64px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-full bg-[#e3f2ea] text-[#2f6f5e] flex items-center justify-center">
              <HeartPulse size={18} strokeWidth={2.2} />
            </div>
            <div className="leading-tight">
              <div className="text-[17px] font-bold text-[#1c2b26]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>MedTime</div>
              <div className="text-[11px] text-[#66756f]">Care team</div>
            </div>
          </div>
          {selectedPatientId && (
            <nav className="hidden lg:flex items-center gap-1" aria-label="Sections">
              {NAV.map((n) => (
                <button key={n.id} onClick={() => setTab(n.id)} aria-current={tab === n.id ? 'page' : undefined}
                  className={`flex items-center gap-2 whitespace-nowrap px-3.5 py-2 rounded-full text-sm font-semibold transition-colors ${tab === n.id ? 'bg-[#e3f2ea] text-[#2f6f5e]' : 'text-[#66756f] hover:text-[#1c2b26] hover:bg-[#f4f7f5]'}`}>
                  <n.icon size={16} />
                  {n.label}
                  {n.id === 'approvals' && approvalsCount > 0 && <span className="text-[10px] font-bold bg-[#a23b32] text-white rounded-full px-1.5 py-0.5">{approvalsCount}</span>}
                </button>
              ))}
            </nav>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <Link to="/caregiver/access" className="hidden md:inline-flex items-center gap-1.5 text-sm font-semibold text-[#2f6f5e] px-3 py-2 rounded-full hover:bg-[#f4f7f5]">
              <Users size={16} /> Access
            </Link>
            <span className="hidden md:inline text-sm font-semibold text-[#1c2b26] px-2">{user?.name || 'Caregiver'}</span>
            <button
              onClick={() => { dispatch(logoutUser()); navigate('/'); }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#66756f] hover:text-[#a23b32] px-3 py-2 rounded-full hover:bg-[#fdecea] transition-colors"
            >
              <LogOut size={16} /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
        {selectedPatientId && (
          <nav className="lg:hidden flex gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none]" aria-label="Sections">
            {NAV.map((n) => (
              <button key={n.id} onClick={() => setTab(n.id)}
                className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-full text-[13px] font-semibold ${tab === n.id ? 'bg-[#e3f2ea] text-[#2f6f5e]' : 'text-[#66756f]'}`}>
                <n.icon size={14} />{n.label}
                {n.id === 'approvals' && approvalsCount > 0 && <span className="text-[10px] font-bold bg-[#a23b32] text-white rounded-full px-1.5">{approvalsCount}</span>}
              </button>
            ))}
          </nav>
        )}
      </header>

      <div className="max-w-[1180px] mx-auto px-4 md:px-7 mt-6 md:mt-10">

        {patients.length === 0 ? (
          /* ─── EMPTY STATE IF NO PATIENTS ARE LINKED ─── */
          <div className="text-center py-16 bg-white rounded-[24px] border-2 border-dashed border-[#e2e9e5]">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-[#e3f2ea] text-[#2f6f5e] flex items-center justify-center"><UserPlus size={26} /></div>
            <h3 className="text-xl font-bold text-[#2f6f5e] mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>No Patients Found</h3>
            <p className="text-[#66756f] font-medium mb-6">Enter your family member's registered phone number to send a link request.</p>
            <div className="max-w-xl mx-auto text-left">{linkForm}</div>
          </div>
        ) : (
          <>
            {/* ─── PATIENT SELECTOR TABS ─── */}
            {patients.length > 1 && (
              <div className="flex gap-3 mb-6 overflow-x-auto pb-2">
                {patients.map(p => (
                  <button
                    key={p.patientId}
                    onClick={() => setSelectedPatientId(p.patientId)}
                    className={`px-6 py-3 rounded-xl font-bold transition-all border-[1.5px] whitespace-nowrap
                      ${selectedPatientId === p.patientId
                        ? 'bg-[#2f6f5e] text-white border-[#2f6f5e]'
                        : 'bg-white text-[#66756f] border-[#e2e9e5] hover:bg-[#eaf3ee]'
                      }
                    `}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}

            {selectedPatientId && (
              <>
                {/* the strip stays loaded on every tab (it feeds the Approvals badge); shown on Overview */}
                <div className={tab === 'today' ? '' : 'hidden'}>
                  <AttentionStrip patientId={selectedPatientId} onOpen={setTab} onCounts={setAttention} />
                </div>
                {tab === 'approvals' && (
                  <div className="space-y-6">
                    <ApprovalsPanel patientId={selectedPatientId} onUpdate={setPendingApprovalsCount} />
                    <PrescriptionReviewPanel patientId={selectedPatientId} />
                    <QuestionsPanel patientId={selectedPatientId} onUpdate={setPendingQuestionsCount} />
                  </div>
                )}
                {tab === 'activity' && (
                  <div className="space-y-6">
                    <ActivityPanel patientId={selectedPatientId} />
                    <CallinSimulator patientId={selectedPatientId} />
                  </div>
                )}
                {tab === 'insights' && (
                  <div className="space-y-6">
                    <WeeklyReviewPanel patientId={selectedPatientId} />
                    <FollowUpsPanel patientId={selectedPatientId} />
                  </div>
                )}
                {tab === 'copilot' && <CaregiverCopilotPanel patientId={selectedPatientId} />}
                {tab === 'setup' && (
                  <div className="space-y-6">
                    <CareSettings patientId={selectedPatientId} />
                    <RoutineProfileEditor patientId={selectedPatientId} />
                    <LifeNotesEditor patientId={selectedPatientId} />
                    <Card>
                      <SectionTitle title="Link another family member" subtitle="Send a link request to another patient's registered phone number." />
                      {linkForm}
                    </Card>
                  </div>
                )}
              </>
            )}

            {/* ─── MAIN CALENDAR DASHBOARD ─── */}
            {selectedPatient && tab === 'today' && (
              <div className="space-y-6">
              <div className="bg-white rounded-[24px] p-5 md:p-8 border-[1.5px] border-[#e2e9e5] shadow-[0_2px_16px_rgba(20,45,38,0.08)]">

                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-[28px] text-[#1c2b26] font-bold leading-none" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                      Doses this week
                    </h2>
                    <p className="text-[13px] text-[#66756f] mt-2 font-bold tracking-wider uppercase">
                      Patient: <span className="text-[#2f6f5e]">{selectedPatient.name}</span> • {selectedPatient.phone}
                    </p>
                  </div>
                  <a href={`tel:${selectedPatient.phone}`} className="bg-white border-[1.5px] border-[#e2e9e5] text-[#1c2b26] px-5 py-2.5 rounded-xl font-bold hover:bg-[#f4f7f5] transition-colors">
                    Call
                  </a>
                </div>

                {/* 1. Date Selector Blocks */}
                <div className="flex gap-3 mb-8 overflow-x-auto pb-2 mt-6">
                  {weekDays.map((d, index) => {
                    const isSelected = selectedDateStr === d.fullDateStr;
                    return (
                      <div
                        key={index}
                        onClick={() => setSelectedDateStr(d.fullDateStr)}
                        className={`flex-1 min-w-[80px] py-4 rounded-xl text-center cursor-pointer transition-all border-[1.5px]
                          ${isSelected
                            ? 'bg-[#eaf3ee] border-[#2f6f5e] text-[#2f6f5e]'
                            : 'bg-[#f4f7f5] border-transparent text-[#1c2b26] hover:border-[#e2e9e5]'
                          }
                        `}
                      >
                        <div className="text-[12px] font-bold uppercase">{d.dayName}</div>
                        <div className="text-[22px] font-bold">{d.dayNum}</div>
                      </div>
                    )
                  })}
                </div>

                {/* 2. The Clinical Table for the Selected Day */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[700px]">
                    <thead>
                      <tr>
                        <th className="pb-4 text-[11px] font-bold text-[#66756f] uppercase border-b-[1.5px] border-[#eaf3ee] w-[15%]">Time</th>
                        <th className="pb-4 text-[11px] font-bold text-[#66756f] uppercase border-b-[1.5px] border-[#eaf3ee] w-[35%]">Medicine</th>
                        <th className="pb-4 text-[11px] font-bold text-[#66756f] uppercase border-b-[1.5px] border-[#eaf3ee] w-[20%]">Meal Timing</th>
                        <th className="pb-4 text-[11px] font-bold text-[#66756f] uppercase border-b-[1.5px] border-[#eaf3ee] w-[15%]">Status</th>
                        <th className="pb-4 text-[11px] font-bold text-[#66756f] uppercase border-b-[1.5px] border-[#eaf3ee] w-[15%]">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoading ? (
                        <tr>
                          <td colSpan="5" className="py-12 text-center text-[#66756f] font-bold">
                            Loading clinical records...
                          </td>
                        </tr>
                      ) : displayedHistory.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="py-12 text-center text-[#66756f] font-bold">
                            No medications scheduled for this day.
                          </td>
                        </tr>
                      ) : (
                        displayedHistory.map((reminder) => {
                          const isTaken = reminder.status === 'taken';
                          const isSkipped = reminder.status === 'skipped';
                          const isMissed = reminder.status === 'missed' || reminder.status === 'alerted';

                          return (
                            <tr key={reminder._id}>
                              <td className="py-5 border-b border-[#f4f7f5] text-[14px] text-[#1c2b26] font-medium">
                                {new Date(reminder.scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="py-5 border-b border-[#f4f7f5] text-[14px] text-[#1c2b26]">
                                {reminder.medicine?.name || 'Unknown'}
                                <span className="bg-[#c5dff0] text-[#1a3e5a] px-2.5 py-1 rounded-full text-[11px] font-bold ml-2">
                                  {reminder.medicine?.dosage}
                                </span>
                              </td>
                              <td className="py-5 border-b border-[#f4f7f5] text-[14px] text-[#1c2b26] capitalize">
                                {reminder.medicine?.mealTiming || 'Anytime'} Food
                              </td>
                              <td className="py-5 border-b border-[#f4f7f5]">
                                {isTaken && <span className="bg-[#d6ebe0] text-[#1e5a45] px-3 py-1.5 rounded-full text-[11px] font-bold">✓ Taken</span>}
                                {isSkipped && <span className="bg-[#eaf3ee] text-[#a23b32] px-3 py-1.5 rounded-full text-[11px] font-bold">Skipped</span>}
                                {isMissed && <span className="bg-[#fdecea] text-[#a23b32] px-3 py-1.5 rounded-full text-[11px] font-bold">Missed</span>}
                                {reminder.status === 'pending' && <span className="bg-gray-100 text-gray-500 px-3 py-1.5 rounded-full text-[11px] font-bold">Pending</span>}
                              </td>
                              <td className="py-5 border-b border-[#f4f7f5]">
                                {(isSkipped || isMissed) ? (
                                  <a href={`tel:${selectedPatient?.phone}`} className="bg-[#2f6f5e] border-[1.5px] border-[#2f6f5e] text-white px-4 py-2 rounded-lg font-bold hover:bg-[#255a4c] text-[13px] transition-colors inline-block text-center">
                                    Call Patient
                                  </a>
                                ) : (
                                  <button className="bg-white border-[1.5px] border-[#e2e9e5] text-[#1c2b26] px-4 py-2 rounded-lg font-bold hover:bg-[#f4f7f5] text-[13px] transition-colors">
                                    Details
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

              </div>
              <JournalPanel patientId={selectedPatientId} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}