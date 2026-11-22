import React, { useState, useRef, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import api from '../utils/api';
import { useNavigate } from 'react-router-dom';
import { logoutUser } from '../redux/authSlice';
import DoctorSettings from '../components/DoctorSettings';
import CareSettings from '../components/CareSettings';
import { Settings, Users, HeartPulse, LogOut, Pill, Plus, Activity, Clock, CheckCircle2, AlertCircle, Phone, MessageSquare, Pencil, X, Check, MapPin, Package } from 'lucide-react';


export default function PatientDashboard() {
  const { user } = useSelector((state) => state.auth);
  const dispatch = useDispatch();
  const navigate = useNavigate();


  // UI States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDoctorPanelOpen, setIsDoctorPanelOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const fileInputRef = useRef(null);

  // Data States
  const [medicines, setMedicines] = useState([]);
  const [editingMedId, setEditingMedId] = useState(null);
  // Calls are the default (they run the assistant); SMS to Indian numbers is limited on the trial.
  const [notificationType, setNotificationType] = useState('call');
  const [saving, setSaving] = useState(false); // one save at a time (double clicks made duplicates)
  const savingRef = useRef(false);
  const [formData, setFormData] = useState({
    name: '',
    dosage: '',
    frequency: 'once',
    time: '08:00',
    mealTiming: 'any',
    tabletCount: '',
    pillDescription: '',
    pillboxSlot: '',
    locationHint: ''
  });

  // --- 1. DATA FETCHING (Auto-updates every 5 seconds) ---
  useEffect(() => {
    const fetchMedicines = async () => {
      try {
        const response = await api.get('/medicines');
        setMedicines(response.data);
      } catch (error) {
        console.error('Failed to fetch medicines:', error);
      }
    };
    fetchMedicines();
    const interval = setInterval(fetchMedicines, 5000);
    return () => clearInterval(interval);
  }, []);

  // --- 2. ACTION FUNCTIONS (These must be OUTSIDE useEffect!) ---
  // A1.4: taken / skipped for this one dose. The server records it through markDose, which also
  // stops that dose's re-call and caregiver alert. A dose already taken stays taken.
  const handleStatusUpdate = async (med, newStatus) => {
    if (!med.todayReminderId) return;
    try {
      const { data } = await api.post(`/doses/${med.todayReminderId}/status`, { status: newStatus });
      const recorded = data?.reminder?.status || newStatus;
      // Instantly update UI to feel fast!
      setMedicines((meds) => meds.map((m) =>
        m._id === med._id ? { ...m, status: recorded, caregiverAlerted: false, snoozeUntil: null } : m
      ));
    } catch (error) {
      console.error(`Failed to mark as ${newStatus}:`, error);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to permanently cancel this medication?')) return;
    try {
      await api.delete(`/medicines/${id}`);
      setMedicines(medicines.filter(med => med._id !== id));
    } catch (error) {
      console.error('Failed to delete medicine:', error);
    }
  };

  const openEditModal = (med) => {
    setEditingMedId(med._id);
    setFormData({
      name: med.name,
      dosage: med.dosage,
      frequency: med.frequency,
      time: med.scheduledTimes[0] || '08:00',
      mealTiming: med.mealTiming,
      tabletCount: med.tabletCount,
      pillDescription: med.pillDescription || '',
      pillboxSlot: med.pillboxSlot || '',
      locationHint: med.locationHint || ''
    });
    setNotificationType(med.notificationType || 'sms');
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await api.put(`/medicines/${editingMedId}`, {
        ...formData,
        scheduledTimes: [formData.time],
        notificationType: notificationType
      });
      // Update the local list so UI changes instantly
      setMedicines(medicines.map(med =>
        med._id === editingMedId ? { ...response.data.medicine, status: med.status } : med
      ));
      setIsEditModalOpen(false);
      setEditingMedId(null);
    } catch (error) {
      console.error('Failed to edit medicine:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return; // a second click while the first save is still running
    savingRef.current = true;
    setSaving(true);
    const body = {
      ...formData,
      scheduledTimes: [formData.time],
      type: 'tablet',
      startDate: new Date(),
      notificationType: notificationType
    };
    try {
      let response;
      try {
        response = await api.post('/medicines', body);
      } catch (err) {
        // The same medicine at the same time is already in the list: add it again only if meant.
        if (err?.response?.status !== 409) throw err;
        if (!window.confirm(`${err.response.data.message}\n\nAdd it again anyway? Two entries mean two reminders.`)) return;
        response = await api.post('/medicines', { ...body, allowDuplicate: true });
      }
      setMedicines([...medicines, response.data.medicine]);
      setIsModalOpen(false);
      setFormData({
        name: '',
        dosage: '',
        frequency: 'once',
        time: '08:00',
        mealTiming: 'any',
        tabletCount: '',
        pillDescription: '',
        pillboxSlot: '',
        locationHint: ''
      });
      setNotificationType('call');
    } catch (error) {
      console.error('Failed to save medicine:', error);
      alert(error?.response?.data?.message || 'Could not save the medicine. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Prevent PDFs/Docs on the client side just in case
    if (!file.type.startsWith('image/')) {
      alert('Please upload an Image (PNG/JPG) of the prescription. PDFs and Word Documents cannot be scanned by the OCR.');
      return;
    }

    // 5MB file size limit (B12 requirement)
    if (file.size > 5 * 1024 * 1024) {
      alert('File is too large. Prescriptions must be 5 MB or smaller.');
      return;
    }

    setIsScanning(true);
    const uploadData = new FormData();
    uploadData.append('prescription', file);

    try {
      // 1. Send image to OCR & Prescription-to-Schedule Agent Backend
      const response = await api.post('/ocr/parse', uploadData, {
        headers: {
          'Content-Type': undefined
        }
      });

      const { proposalId, proposalLevel, medicines: extractedMeds, message, timingConflicts = [] } = response.data;
      // Food rule vs her meals (B12): shown before approving, with the suggested time
      const timingNote = timingConflicts.length ? `\n\nPlease check:\n${timingConflicts.map(c => `${c.message}`).join('\n')}` : '';

      if (proposalId && extractedMeds && extractedMeds.length > 0) {
        // If Level 1 (clear lines, no conflicts), patient/caregiver can approve immediately
        if (proposalLevel === 1) {
          const autoApprove = window.confirm(
            `Prescription parsed ${extractedMeds.length} medicine(s) successfully:\n` +
            extractedMeds.map(m => `• ${m.name} (${m.strength || ''}) - ${m.frequency || 'once'} at ${(m.scheduledTimes || []).join(', ')}`).join('\n') +
            timingNote +
            `\n\nWould you like to approve and add these to your schedule now?`
          );

          if (autoApprove) {
            await api.post(`/ocr/proposals/${proposalId}/approve`);
            const refreshRes = await api.get('/medicines');
            setMedicines(refreshRes.data);
            alert(`Schedule approved! Added ${extractedMeds.length} medicines.`);
          } else {
            alert('Prescription schedule proposal saved. Awaiting review.');
          }
        } else {
          // Level 2: Doctor review required
          alert(`Prescription scanned! Some lines require clinical review (Level 2). A proposal has been queued for your doctor or primary caregiver.`);
        }

        setIsModalOpen(false);
      } else {
        alert('Could not detect clear medicines in this image. Please enter them manually.');
      }

    } catch (error) {
      console.error('Failed to parse prescription:', error);
      alert(error.response?.data?.message || 'Could not read the prescription.');
    } finally {
      setIsScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- 3. UI RENDERING ---
  // Overview numbers (UI pass): today's progress, the next dose, what's coming up
  const firstName = (user?.name || '').split(' ')[0] || 'there';
  const hourIST = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
  const greeting = hourIST < 12 ? 'Good morning' : hourIST < 17 ? 'Good afternoon' : 'Good evening';
  const timeOf = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
  const takenCount = medicines.filter((m) => m.status === 'taken').length;
  const progressPct = medicines.length ? Math.round((takenCount / medicines.length) * 100) : 0;
  const dueNow = medicines.filter((m) => m.status === 'due' || m.status === 'overdue');
  const upcoming = medicines.filter((m) => m.status === 'upcoming' && m.doseTime).sort((a, b) => new Date(a.doseTime) - new Date(b.doseTime));
  const nextDose = dueNow[0] || upcoming[0] || null;

  return (
    <div className="min-h-screen bg-cream text-textDark font-sans pb-12">

      {/* Top navigation */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur border-b border-[#e2e9e5]">
        <div className="max-w-6xl mx-auto px-4 md:px-8 h-[64px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-9 h-9 rounded-full bg-[#e3f2ea] text-[#2f6f5e] flex items-center justify-center"><HeartPulse size={18} strokeWidth={2.2} /></div>
            <div className="leading-tight">
              <div className="text-[17px] font-bold text-[#1c2b26]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>MedTime</div>
              <div className="text-[11px] text-[#66756f]">Better habits, calmer days</div>
            </div>
          </div>
          <nav className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Sections">
            <button className="flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 rounded-full text-sm font-semibold bg-[#e3f2ea] text-[#2f6f5e]"><HeartPulse size={15} /> Home</button>
            <button onClick={() => navigate('/vitals')} className="flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 rounded-full text-sm font-semibold text-[#66756f] hover:bg-[#f4f7f5] hover:text-[#1c2b26]"><Activity size={15} /> Vitals</button>
            <button onClick={() => setIsDoctorPanelOpen(true)} className="flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 rounded-full text-sm font-semibold text-[#66756f] hover:bg-[#f4f7f5] hover:text-[#1c2b26]"><Settings size={15} /> Settings</button>
            <button onClick={() => navigate('/caregiver/access')} className="flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 rounded-full text-sm font-semibold text-[#66756f] hover:bg-[#f4f7f5] hover:text-[#1c2b26]"><Users size={15} /> Caregivers</button>
          </nav>
          <div className="flex items-center gap-2 shrink-0">
            <button className="hidden sm:flex items-center gap-2 bg-[#fdf0ee] border border-[#f5d3ce] text-[#a23b32] rounded-full px-4 py-2 text-sm font-bold">
              <span className="w-2 h-2 rounded-full bg-[#c0574d] animate-pulse" /> SOS
            </button>
            <button onClick={() => { dispatch(logoutUser()); navigate('/'); }} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#66756f] hover:text-[#a23b32] px-3 py-2 rounded-full hover:bg-[#fdecea]">
              <LogOut size={16} /> <span className="hidden md:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 md:px-8 pt-8">
        {/* Greeting */}
        <div className="mb-6">
          <p className="text-[#66756f] text-sm">{greeting},</p>
          <h1 className="text-3xl md:text-4xl font-bold text-[#1c2b26]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{firstName}</h1>
          <p className="text-[#66756f] text-sm mt-1">{medicines.length ? `${takenCount} of ${medicines.length} medicines taken today.` : 'Add your first medicine to get started.'}</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Next dose */}
            <section className="relative overflow-hidden rounded-3xl p-6 md:p-8 text-white bg-gradient-to-br from-[#2f6f5e] via-[#3c7f6c] to-[#6fa596] min-h-[190px]">
              <div className="absolute -right-10 -top-10 w-56 h-56 rounded-full bg-white/10" />
              <div className="absolute right-16 -bottom-16 w-44 h-44 rounded-full bg-white/5" />
              <div className="relative">
                <div className="text-[11px] font-semibold tracking-[0.18em] uppercase text-white/80">
                  {nextDose ? `Next dose · ${dueNow.includes(nextDose) ? 'now' : timeOf(nextDose.doseTime)}` : 'All set'}
                </div>
                <h2 className="mt-2 text-3xl md:text-4xl uppercase leading-none" style={{ fontFamily: "'Anton', 'Plus Jakarta Sans', sans-serif", letterSpacing: '0.01em' }}>
                  {nextDose ? `${nextDose.name} ${nextDose.dosage || ''}` : 'Nothing due right now'}
                </h2>
                <p className="mt-2 text-white/85 text-sm max-w-md">Small, steady habits make calmer days. MedTime will call you when it's time.</p>
                {nextDose && dueNow.includes(nextDose) && (
                  <button onClick={() => handleStatusUpdate(nextDose, 'taken')} className="mt-5 inline-flex items-center gap-2 bg-white text-[#1c2b26] px-5 py-2.5 rounded-full text-sm font-semibold hover:bg-[#f4f7f5]">
                    <CheckCircle2 size={16} className="text-[#2f6f5e]" /> Mark {nextDose.name} as taken
                  </button>
                )}
              </div>
            </section>

            {/* Today's medicines */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-[#1c2b26]">Your medicines</h2>
                <button onClick={() => setIsModalOpen(true)} className="text-sm font-semibold text-[#2f6f5e] hover:underline">Add medicine</button>
              </div>
              {medicines.length === 0 ? (
                <div className="p-10 text-center bg-white rounded-3xl border border-dashed border-[#e2e9e5]">
                  <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-[#e3f2ea] text-[#2f6f5e] flex items-center justify-center"><Pill size={22} /></div>
                  <p className="text-[#66756f] text-sm">No medicines yet. Add one, or scan a prescription.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {medicines.map((med) => {
              const isMissed = !!med.caregiverAlerted || med.status === 'missed';
              const isSnoozed = !isMissed && !!med.snoozeUntil;
              const tone = isMissed || med.status === 'skipped' ? 'rose' : isSnoozed || med.status === 'due' || med.status === 'overdue' ? 'amber' : med.status === 'taken' ? 'mint' : 'lavender';
              const TONE = {
                mint: { card: 'bg-[#eef7f2] border-[#d6ebe0]', icon: 'bg-white text-[#2f6f5e]', bar: 'bg-[#2f6f5e]', pct: 'w-full' },
                amber: { card: 'bg-[#fdf6e7] border-[#f3e1b5]', icon: 'bg-white text-[#b7791f]', bar: 'bg-[#d69e2e]', pct: 'w-1/2' },
                rose: { card: 'bg-[#fdf0ee] border-[#f5d3ce]', icon: 'bg-white text-[#a23b32]', bar: 'bg-[#c0574d]', pct: 'w-1/4' },
                lavender: { card: 'bg-[#f3f2fb] border-[#e2e0f4]', icon: 'bg-white text-[#5b57a6]', bar: 'bg-[#8b87c9]', pct: 'w-0' },
              }[tone];
              const statusText = isMissed ? (med.caregiverAlerted ? 'Missed · family told' : 'Missed') : isSnoozed ? 'Snoozed' : med.status === 'taken' ? 'Taken' : med.status === 'skipped' ? 'Skipped' : med.status === 'due' ? 'Due now' : med.status === 'overdue' ? 'Not confirmed yet' : `Later${med.doseTime ? ` · ${timeOf(med.doseTime)}` : ''}`;

              return (
                <div key={med._id} className={`rounded-3xl p-5 border flex flex-col gap-3 transition-colors ${TONE.card}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center shadow-sm ${TONE.icon}`}><Pill size={20} /></div>
                    <span className="text-[11px] font-semibold text-[#66756f] inline-flex items-center gap-1">
                      {med.notificationType === 'call' ? <Phone size={12} /> : <MessageSquare size={12} />}{med.notificationType === 'call' ? 'Call' : 'SMS'}
                    </span>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-[#1c2b26] leading-tight" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{med.name}</div>
                    <div className="text-[13px] text-[#66756f] mt-0.5">{med.dosage} · {med.scheduledTimes?.join(', ')} · <span className="capitalize">{med.mealTiming === 'any' ? 'any time' : `${med.mealTiming} food`}</span></div>
                  </div>
                  {(med.pillDescription || med.locationHint || med.pillboxSlot) && (
                    <div className="flex flex-wrap gap-1.5 text-[11px] text-[#46564f]">
                      {med.pillDescription && <span className="inline-flex items-center gap-1 bg-white/80 rounded-full px-2 py-0.5"><Pill size={11} />{med.pillDescription}</span>}
                      {med.pillboxSlot && <span className="inline-flex items-center gap-1 bg-white/80 rounded-full px-2 py-0.5"><Package size={11} />{med.pillboxSlot}</span>}
                      {med.locationHint && <span className="inline-flex items-center gap-1 bg-white/80 rounded-full px-2 py-0.5"><MapPin size={11} />{med.locationHint}</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full bg-white overflow-hidden"><div className={`h-full rounded-full ${TONE.bar} ${TONE.pct}`} /></div>
                    <span className="text-xs font-semibold text-[#1c2b26] whitespace-nowrap">{statusText}</span>
                  </div>
                  <div className="flex gap-2 pt-1">
                    {(med.status === 'due' || med.status === 'overdue') && (
                      <>
                        <button onClick={() => handleStatusUpdate(med, 'taken')} className="flex-1 inline-flex items-center justify-center gap-1.5 bg-[#2f6f5e] text-white py-2 rounded-full font-semibold text-sm hover:bg-[#255a4c] transition-colors">
                          <Check size={15} /> Take
                        </button>
                        <button onClick={() => handleStatusUpdate(med, 'skipped')} className="flex-1 inline-flex items-center justify-center gap-1.5 bg-white text-[#a23b32] py-2 rounded-full font-semibold text-sm border border-[#f5d3ce] hover:bg-[#fdf0ee] transition-colors">
                          <X size={15} /> Skip
                        </button>
                      </>
                    )}
                    <button onClick={() => openEditModal(med)} title="Edit medication" className="inline-flex items-center justify-center gap-1 bg-white text-[#2f6f5e] px-3.5 py-2 rounded-full font-semibold text-sm border border-[#e2e9e5] hover:bg-[#f4f7f5] transition-colors">
                      <Pencil size={14} /> Edit
                    </button>
                    <button onClick={() => handleDelete(med._id)} title="Cancel medication" className="inline-flex items-center justify-center bg-white text-[#66756f] px-3.5 py-2 rounded-full font-semibold text-sm border border-[#e2e9e5] hover:bg-[#f4f7f5] transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })}

                </div>
              )}
            </section>
          </div>

          {/* Right column */}
          <aside className="space-y-6">
            <section className="rounded-3xl p-6 bg-[#eef7f2] border border-[#d6ebe0]">
              <h2 className="text-base font-bold text-[#1c2b26] mb-4">Today's progress</h2>
              <div className="flex items-center gap-5">
                <div className="relative w-28 h-28 shrink-0">
                  <svg viewBox="0 0 36 36" className="w-28 h-28 -rotate-90">
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#d6ebe0" strokeWidth="3.2" />
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="#2f6f5e" strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${(progressPct / 100) * 97.4} 97.4`} />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-xl font-bold text-[#1c2b26]">{progressPct}%</div>
                </div>
                <div>
                  <div className="font-semibold text-[#1c2b26]">{progressPct >= 100 ? 'All done today' : takenCount ? "You're on track" : 'Not started yet'}</div>
                  <div className="text-sm text-[#66756f] mt-1">{takenCount} of {medicines.length} taken.{dueNow.length ? ` ${dueNow.length} due now.` : ''}</div>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-base font-bold text-[#1c2b26] mb-3">Quick actions</h2>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-[#eef7f2] text-left text-sm font-semibold text-[#1c2b26] hover:brightness-95"><span className="w-8 h-8 rounded-full bg-white text-[#2f6f5e] flex items-center justify-center"><Plus size={16} /></span>Add medicine</button>
                <button onClick={() => navigate('/vitals')} className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-[#eaf2fb] text-left text-sm font-semibold text-[#1c2b26] hover:brightness-95"><span className="w-8 h-8 rounded-full bg-white text-[#3a6fa0] flex items-center justify-center"><Activity size={16} /></span>Vitals</button>
                <button onClick={() => setIsDoctorPanelOpen(true)} className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-[#fdf6e7] text-left text-sm font-semibold text-[#1c2b26] hover:brightness-95"><span className="w-8 h-8 rounded-full bg-white text-[#b7791f] flex items-center justify-center"><Settings size={16} /></span>Settings</button>
                <button onClick={() => navigate('/caregiver/access')} className="flex items-center gap-2.5 p-3.5 rounded-2xl bg-[#f3f2fb] text-left text-sm font-semibold text-[#1c2b26] hover:brightness-95"><span className="w-8 h-8 rounded-full bg-white text-[#5b57a6] flex items-center justify-center"><Users size={16} /></span>Caregivers</button>
              </div>
            </section>

            <section className="rounded-3xl p-6 bg-white border border-[#e2e9e5]">
              <h2 className="text-base font-bold text-[#1c2b26] mb-3">Coming up</h2>
              {upcoming.length === 0 ? (
                <p className="text-sm text-[#66756f]">No more doses today.</p>
              ) : (
                <ul className="space-y-3">
                  {upcoming.slice(0, 5).map((m) => (
                    <li key={m._id} className="flex items-center gap-3 text-sm">
                      <Clock size={15} className="text-[#8b87c9] shrink-0" />
                      <span className="w-20 text-[#66756f] shrink-0">{timeOf(m.doseTime)}</span>
                      <span className="font-semibold text-[#1c2b26] truncate">{m.name}</span>
                    </li>
                  ))}
                </ul>
              )}
              {medicines.some((m) => m.caregiverAlerted || m.status === 'missed') && (
                <div className="mt-4 flex items-start gap-2 text-xs text-[#a23b32] bg-[#fdf0ee] rounded-xl p-3"><AlertCircle size={14} className="shrink-0 mt-0.5" /> A dose was missed today; your family has been told.</div>
              )}
            </section>
          </aside>
        </div>
      </main>

      {/* ── My Doctor Slide-In Panel ─────────────────────────────────────────── */}
      {/* Backdrop */}
      {isDoctorPanelOpen && (
        <div
          className="fixed inset-0 bg-[#1c2b26]/40 backdrop-blur-sm z-40"
          onClick={() => setIsDoctorPanelOpen(false)}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-[480px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${isDoctorPanelOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-sand bg-gradient-to-r from-[#e3f2ea] to-[#e8f0fb]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center shadow-sm">
              <Settings size={18} className="text-[#2f6f5e]" />
            </div>
            <div>
              <h2 className="font-serif text-lg text-brown2 font-semibold leading-tight">Settings</h2>
              <p className="text-xs text-textLight">Calls, your doctor &amp; monthly reports</p>
            </div>
          </div>
          <button
            onClick={() => setIsDoctorPanelOpen(false)}
            className="w-8 h-8 rounded-full bg-white/70 flex items-center justify-center text-textLight hover:bg-white hover:text-brown2 transition-colors shadow-sm"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4"><CareSettings /></div>
          <DoctorSettings />
        </div>
      </div>

      {/* --- ADD MEDICINE MODAL --- */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-[#1c2b26]/60 backdrop-blur-sm z-50 overflow-y-auto p-4" style={{ overflowY: 'auto' }}>
          <div className="bg-white rounded-[24px] p-6 sm:p-8 w-full max-w-lg shadow-2xl mx-auto my-4" style={{ maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto' }}>
            <h2 className="font-serif text-2xl text-brown2 mb-6">Add New Medication</h2>
            {/* Change accept="image/*,application/pdf" to strictly images */}
            <input type="file" accept="image/png, image/jpeg" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
            <button type="button" onClick={() => fileInputRef.current.click()} disabled={isScanning} className="w-full mb-6 py-4 rounded-xl border-2 border-dashed border-sky3 bg-[#f0f7fc] text-sky3 font-bold flex items-center justify-center gap-2 hover:bg-[#e0f0fa] transition-colors disabled:opacity-70">
              {isScanning ? 'Analyzing Prescription...' : 'Scan Prescription (Auto-Fill)'}
            </button>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Medicine Name</label>
                  <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" placeholder="e.g. Crocin" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Dosage</label>
                  <input type="text" required value={formData.dosage} onChange={(e) => setFormData({ ...formData, dosage: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" placeholder="e.g. 500mg" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Frequency</label>
                  <select value={formData.frequency} onChange={(e) => setFormData({ ...formData, frequency: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="once">Once Daily</option>
                    <option value="twice">Twice Daily</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Time</label>
                  <input type="time" required value={formData.time} onChange={(e) => setFormData({ ...formData, time: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Meal Timing</label>
                  <select value={formData.mealTiming} onChange={(e) => setFormData({ ...formData, mealTiming: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="before">Before Food</option>
                    <option value="after">After Food</option>
                    <option value="any">Anytime</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Pill Stock</label>
                  <input type="number" required value={formData.tabletCount} onChange={(e) => setFormData({ ...formData, tabletCount: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" placeholder="30" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Alert Method</label>
                  <select value={notificationType} onChange={(e) => setNotificationType(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="sms">SMS Text Message</option>
                    <option value="call">Automated Voice Call</option>
                  </select>
                </div>
                {/* ── C10 Fields: Step-by-Step Guidance (Voice Agent) ── */}
                <div className="col-span-2 pt-2 border-t border-sand">
                  <h3 className="text-xs font-bold text-textDark uppercase tracking-wider mb-2">Step-by-Step Guidance (C10 Hints)</h3>
                </div>
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">
                    Pill Appearance / Description <span className="text-xs font-normal text-gray-400">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.pillDescription}
                    onChange={(e) => setFormData({ ...formData, pillDescription: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg text-sm"
                    placeholder="e.g. Small round white tablet with a center score"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">
                    Pillbox Slot <span className="text-xs font-normal text-gray-400">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.pillboxSlot}
                    onChange={(e) => setFormData({ ...formData, pillboxSlot: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg text-sm"
                    placeholder="e.g. Monday Morning / Slot 1"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">
                    Storage Location Hint <span className="text-xs font-normal text-gray-400">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.locationHint}
                    onChange={(e) => setFormData({ ...formData, locationHint: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg text-sm"
                    placeholder="e.g. Kitchen table beside water jug"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="submit" disabled={saving} className="flex-[2] bg-brown2 text-white py-3 rounded-lg font-bold hover:bg-[#255a4c] disabled:opacity-60 disabled:cursor-wait">{saving ? 'Saving…' : 'Schedule & Save'}</button>
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 bg-white border-2 border-sand text-textDark py-3 rounded-lg font-bold hover:bg-cream">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- EDIT MEDICINE MODAL --- */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-[#1c2b26]/60 backdrop-blur-sm z-50 overflow-y-auto p-4" style={{ overflowY: 'auto' }}>
          <div className="bg-white rounded-[24px] p-6 sm:p-8 w-full max-w-lg shadow-2xl mx-auto my-4" style={{ maxHeight: 'calc(100vh - 2rem)', overflowY: 'auto' }}>
            <h2 className="font-serif text-2xl text-brown2 mb-6">Edit Medication</h2>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Medicine Name</label>
                  <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Dosage</label>
                  <input type="text" required value={formData.dosage} onChange={(e) => setFormData({ ...formData, dosage: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Frequency</label>
                  <select value={formData.frequency} onChange={(e) => setFormData({ ...formData, frequency: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="once">Once Daily</option>
                    <option value="twice">Twice Daily</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Time</label>
                  <input type="time" required value={formData.time} onChange={(e) => setFormData({ ...formData, time: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Meal Timing</label>
                  <select value={formData.mealTiming} onChange={(e) => setFormData({ ...formData, mealTiming: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="before">Before Food</option>
                    <option value="after">After Food</option>
                    <option value="any">Anytime</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Pill Stock</label>
                  <input type="number" required value={formData.tabletCount} onChange={(e) => setFormData({ ...formData, tabletCount: e.target.value })} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Alert Method</label>
                  <select value={notificationType} onChange={(e) => setNotificationType(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="sms">SMS Text Message</option>
                    <option value="call">Automated Voice Call</option>
                  </select>
                </div>
                {/* ── C10 Fields: Step-by-Step Guidance (Voice Agent) ── */}
                <div className="col-span-2 pt-2 border-t border-sand">
                  <h3 className="text-xs font-bold text-textDark uppercase tracking-wider mb-2">Step-by-Step Guidance (C10 Hints)</h3>
                </div>
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">
                    Pill Appearance / Description <span className="text-xs font-normal text-gray-400">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.pillDescription}
                    onChange={(e) => setFormData({ ...formData, pillDescription: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg text-sm"
                    placeholder="e.g. Small round white tablet with a center score"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">
                    Pillbox Slot <span className="text-xs font-normal text-gray-400">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.pillboxSlot}
                    onChange={(e) => setFormData({ ...formData, pillboxSlot: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg text-sm"
                    placeholder="e.g. Monday Morning / Slot 1"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">
                    Storage Location Hint <span className="text-xs font-normal text-gray-400">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={formData.locationHint}
                    onChange={(e) => setFormData({ ...formData, locationHint: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg text-sm"
                    placeholder="e.g. Kitchen table beside water jug"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-[2] bg-sky2 text-white py-3 rounded-lg font-bold hover:bg-[#2c658a]">Save Changes</button>
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="flex-1 bg-white border-2 border-sand text-textDark py-3 rounded-lg font-bold hover:bg-cream">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}