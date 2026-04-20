import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import api from '../utils/api';

export default function CaregiverDashboard() {
  const { user } = useSelector((state) => state.auth);
  
  // State
  const [patients, setPatients] = useState([]);
  const [selectedPatientId, setSelectedPatientId] = useState(null);
  const [patientHistory, setPatientHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  
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

  return (
    <div className="min-h-screen bg-[#fdf8f0] text-[#2d2418] font-sans pb-12" style={{ fontFamily: "'Nunito', sans-serif" }}>
      
      {/* ─── TOP NAV ─── */}
      <nav className="sticky top-0 z-40 bg-white border-b-[1.5px] border-[#e8dcc8] px-8 h-[68px] flex items-center shadow-[0_2px_12px_rgba(90,60,30,0.06)] justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-[#f2c4b5] to-[#dbd3ef] rounded-[10px] flex items-center justify-center text-xl">
            💊
          </div>
          <span className="text-xl text-[#5c4535] font-medium" style={{ fontFamily: "'Lora', serif" }}>
            MedTime Care
          </span>
        </div>
        <div className="flex gap-4">
          <span className="text-[14px] font-bold text-[#8a7560] px-3 py-2">
            Welcome, {user?.name || 'Caregiver'}
          </span>
        </div>
      </nav>

      <div className="max-w-[1180px] mx-auto px-7 mt-10">

        {/* ─── LINK NEW PATIENT SECTION ─── */}
        <div className="bg-white rounded-[18px] p-6 border-[1.5px] border-[#f5ede0] shadow-[0_2px_16px_rgba(90,60,30,0.08)] mb-8">
          <h2 className="text-[22px] text-[#5c4535] mb-4" style={{ fontFamily: "'Lora', serif" }}>
            Link a Family Member
          </h2>
          <form onSubmit={handleLinkPatient} className="flex gap-3 items-center flex-wrap md:flex-nowrap">
            <input 
              type="text" 
              placeholder="Enter patient's registered phone number (e.g. 9876543210)" 
              value={linkPhone}
              onChange={(e) => setLinkPhone(e.target.value)}
              className="flex-1 px-4 py-[13px] bg-white border-[1.5px] border-[#e8dcc8] rounded-xl outline-none focus:border-[#5c4535] font-sans transition-colors w-full"
              required
            />
            <button type="submit" className="bg-[#5c4535] text-white px-6 py-[13px] rounded-xl font-bold hover:bg-[#4a3628] transition-colors border-[1.5px] border-[#5c4535] w-full md:w-auto whitespace-nowrap">
              Link Patient
            </button>
          </form>
          {linkMessage && (
            <p className={`text-sm mt-3 font-bold ${linkMessage.type === 'success' ? 'text-[#7da876]' : 'text-[#e8a090]'}`}>
              {linkMessage.text}
            </p>
          )}
        </div>

        {patients.length === 0 ? (
          /* ─── EMPTY STATE IF NO PATIENTS ARE LINKED ─── */
          <div className="text-center py-16 bg-white rounded-[24px] border-2 border-dashed border-[#e8dcc8]">
            <div className="text-4xl mb-4">🩺</div>
            <h3 className="text-xl font-bold text-[#5c4535] mb-2" style={{ fontFamily: "'Lora', serif" }}>No Patients Found</h3>
            <p className="text-[#8a7560] font-medium">Enter your family member's registered phone number above to start monitoring their medications.</p>
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
                        ? 'bg-[#5c4535] text-white border-[#5c4535]' 
                        : 'bg-white text-[#8a7560] border-[#e8dcc8] hover:bg-[#f5ede0]'
                      }
                    `}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}

            {/* ─── MAIN CALENDAR DASHBOARD ─── */}
            {selectedPatient && (
              <div className="bg-white rounded-[24px] p-8 border-[1.5px] border-[#e8dcc8] shadow-[0_2px_16px_rgba(90,60,30,0.08)]">
                
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-[28px] text-[#2d2418] font-bold leading-none" style={{ fontFamily: "'Lora', serif" }}>
                      Weekly Clinical Calendar
                    </h2>
                    <p className="text-[13px] text-[#8a7560] mt-2 font-bold tracking-wider uppercase">
                      Patient: <span className="text-[#5c4535]">{selectedPatient.name}</span> • 📞 {selectedPatient.phone}
                    </p>
                  </div>
                  <a href={`tel:${selectedPatient.phone}`} className="bg-white border-[1.5px] border-[#e8dcc8] text-[#2d2418] px-5 py-2.5 rounded-xl font-bold hover:bg-[#fdf8f0] transition-colors">
                    📞 Call
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
                            ? 'bg-[#f5ede0] border-[#5c4535] text-[#5c4535]' 
                            : 'bg-[#fdf8f0] border-transparent text-[#2d2418] hover:border-[#e8dcc8]'
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
                        <th className="pb-4 text-[11px] font-bold text-[#8a7560] uppercase border-b-[1.5px] border-[#f5ede0] w-[15%]">Time</th>
                        <th className="pb-4 text-[11px] font-bold text-[#8a7560] uppercase border-b-[1.5px] border-[#f5ede0] w-[35%]">Medicine</th>
                        <th className="pb-4 text-[11px] font-bold text-[#8a7560] uppercase border-b-[1.5px] border-[#f5ede0] w-[20%]">Meal Timing</th>
                        <th className="pb-4 text-[11px] font-bold text-[#8a7560] uppercase border-b-[1.5px] border-[#f5ede0] w-[15%]">Status</th>
                        <th className="pb-4 text-[11px] font-bold text-[#8a7560] uppercase border-b-[1.5px] border-[#f5ede0] w-[15%]">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isLoading ? (
                        <tr>
                          <td colSpan="5" className="py-12 text-center text-[#8a7560] font-bold">
                            Loading clinical records...
                          </td>
                        </tr>
                      ) : displayedHistory.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="py-12 text-center text-[#8a7560] font-bold">
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
                              <td className="py-5 border-b border-[#fdf8f0] text-[14px] text-[#2d2418] font-medium">
                                {new Date(reminder.scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="py-5 border-b border-[#fdf8f0] text-[14px] text-[#2d2418]">
                                {reminder.medicine?.name || 'Unknown'} 
                                <span className="bg-[#c5dff0] text-[#1a3e5a] px-2.5 py-1 rounded-full text-[11px] font-bold ml-2">
                                  {reminder.medicine?.dosage}
                               </span>
                              </td>
                              <td className="py-5 border-b border-[#fdf8f0] text-[14px] text-[#2d2418] capitalize">
                                {reminder.medicine?.mealTiming || 'Anytime'} Food
                              </td>
                              <td className="py-5 border-b border-[#fdf8f0]">
                                {isTaken && <span className="bg-[#c8d9c4] text-[#2a4a28] px-3 py-1.5 rounded-full text-[11px] font-bold">✓ Taken</span>}
                                {isSkipped && <span className="bg-[#f5ede0] text-[#7a2a1a] px-3 py-1.5 rounded-full text-[11px] font-bold">🚫 Skipped</span>}
                                {isMissed && <span className="bg-[#f7ddd4] text-[#7a2a1a] px-3 py-1.5 rounded-full text-[11px] font-bold">⚠️ Missed</span>}
                                {reminder.status === 'pending' && <span className="bg-gray-100 text-gray-500 px-3 py-1.5 rounded-full text-[11px] font-bold">⏳ Pending</span>}
                              </td>
                              <td className="py-5 border-b border-[#fdf8f0]">
                                {(isSkipped || isMissed) ? (
                                  <a href={`tel:${selectedPatient?.phone}`} className="bg-[#5c4535] border-[1.5px] border-[#5c4535] text-white px-4 py-2 rounded-lg font-bold hover:bg-[#4a3628] text-[13px] transition-colors inline-block text-center">
                                    Call Patient
                                  </a>
                                ) : (
                                  <button className="bg-white border-[1.5px] border-[#e8dcc8] text-[#2d2418] px-4 py-2 rounded-lg font-bold hover:bg-[#fdf8f0] text-[13px] transition-colors">
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
            )}
          </>
        )}
      </div>
    </div>
  );
}