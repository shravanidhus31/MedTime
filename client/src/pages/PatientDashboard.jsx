import React, { useState, useRef, useEffect } from 'react';
import { useSelector } from 'react-redux';
import api from '../utils/api';
import { useNavigate } from 'react-router-dom'; // Add this line
import DoctorSettings from '../components/DoctorSettings';


export default function PatientDashboard() {
  const { user } = useSelector((state) => state.auth);
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
  const [notificationType, setNotificationType] = useState('sms');
  const [formData, setFormData] = useState({
    name: '',
    dosage: '',
    frequency: 'once',
    time: '08:00', 
    mealTiming: 'any',
    tabletCount: ''
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
  const handleStatusUpdate = async (id, newStatus) => {
    try {
      await api.post(`/medicines/${id}/status`, { status: newStatus });
      // Instantly update UI to feel fast!
      setMedicines(medicines.map(med => 
        med._id === id ? { ...med, status: newStatus } : med
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
    try {
      const response = await api.post('/medicines', {
        ...formData,
        scheduledTimes: [formData.time],
        type: 'tablet',
        startDate: new Date(),
        notificationType: notificationType
      });
      setMedicines([...medicines, response.data.medicine]);
      setIsModalOpen(false);
      setFormData({ name: '', dosage: '', frequency: 'once', time: '08:00', mealTiming: 'any', tabletCount: '' });
      setNotificationType('sms');
    } catch (error) {
      console.error('Failed to save medicine:', error);
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

    setIsScanning(true);
    const uploadData = new FormData();
    uploadData.append('prescription', file);

    try {
      // 1. Send image to Tesseract Backend
      const response = await api.post('/ocr/parse', uploadData, {
        headers: {
          'Content-Type':undefined
        }
        
      });

      const { extractedMedicines } = response.data;

      if (extractedMedicines && extractedMedicines.length > 0) {
        // 2. We found multiple medicines! Let's auto-save them all to the DB immediately.
        const savePromises = extractedMedicines.map(med => {
          return api.post('/medicines', {
            name: med.name,
            dosage: med.dosage,
            frequency: med.frequency,
            scheduledTimes: [med.time],
            type: 'tablet',
            mealTiming: med.mealTiming,
            startDate: new Date(),
            tabletCount: 30, // Defaulting stock to 30 for auto-scans
            notificationType: 'sms'
          });
        });

        // Wait for all of them to save
        await Promise.all(savePromises);

        // 3. Refresh the dashboard to show the new list!
        const refreshRes = await api.get('/medicines');
        setMedicines(refreshRes.data);
        
        setIsModalOpen(false); // Close the modal, we're done!
        alert(`Successfully scanned and auto-scheduled ${extractedMedicines.length} medicines!`);

      } else {
        alert('We could not detect any standard medicines in this image. Please enter them manually.');
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
  return (
    <div className="min-h-screen bg-cream text-textDark font-sans pb-12">
      
      {/* Top Navigation */}
      <nav className="sticky top-0 z-40 bg-white border-b border-sand px-8 h-[68px] flex items-center shadow-sm">
        <div className="flex items-center gap-3 mr-10">
          <div className="w-10 h-10 bg-gradient-to-br from-blush2 to-sky rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <span className="font-serif text-xl text-brown2 font-medium">MedTime</span>
        </div>
        <div className="flex gap-2 flex-1 overflow-x-auto">
          <button className="px-4 py-2 rounded-lg text-sm font-semibold bg-parchment text-brown2">Home</button>
          <button className="px-4 py-2 rounded-lg text-sm font-semibold text-textLight hover:bg-cream hover:text-textDark transition-colors">Schedule</button>
          <button onClick={() => navigate('/vitals')} className="px-4 py-2 rounded-lg text-sm font-semibold text-textLight hover:bg-cream hover:text-textDark transition-colors">Vitals</button>
          <button
            onClick={() => setIsDoctorPanelOpen(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-textLight hover:bg-cream hover:text-textDark transition-colors flex items-center gap-1.5"
          >
            <span className="text-base">🩺</span> My Doctor
          </button>
        </div>
        <button className="flex items-center gap-2 bg-[#fff0ef] border-[1.5px] border-rose text-[#c0392b] rounded-lg px-4 py-2 font-bold transition-transform hover:scale-105">
          <span className="w-2 h-2 rounded-full bg-rose animate-pulse"></span> SOS
        </button>
      </nav>

      {/* Hero Banner */}
      <div className="h-[180px] relative overflow-hidden mb-8 bg-gradient-to-r from-[#fae8d8] via-[#f0dded] to-[#dde8f5]">
        <div className="absolute inset-0 flex items-center px-10 max-w-6xl mx-auto w-full">
          <div>
            <h1 className="font-serif text-3xl text-brown2 leading-tight">Good morning, {user?.name || 'Ramesh'}</h1>
            <p className="text-textLight text-[15px] mt-1">You have <strong className="text-textDark">{medicines.length} medicines</strong> active.</p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setIsModalOpen(true)} className="bg-brown2 text-white px-5 py-2.5 rounded-lg font-bold text-sm hover:bg-[#4a3628] transition-colors flex items-center gap-2">
                + Add Medicine
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-6xl mx-auto px-8">
        <h2 className="font-serif text-2xl text-brown2 mb-4">Your Active Prescriptions</h2>
        
        {medicines.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-xl border border-dashed border-sand">
            <p className="text-textLight">No medicines added yet. Click "Add Medicine" to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* EXACTLY ONE CLEAN MAP LOOP HERE */}
            {medicines.map((med) => {
              // ── Escalation Engine Visual State (priority order) ─────────────
              // 1. caregiverAlerted → solid red (missed, caregiver was notified)
              // 2. snoozeUntil set → amber (patient snoozed, awaiting re-call)
              // 3. Reminder-based status fallback (taken / skipped / due / upcoming)
              const isMissed  = !!med.caregiverAlerted;
              const isSnoozed = !isMissed && !!med.snoozeUntil;

              const cardClass = isMissed
                ? 'bg-[#ffebee] border-[#e57373]'          // solid red — missed
                : isSnoozed
                ? 'bg-[#fff8e1] border-[#ffca28]'          // amber — snoozed
                : med.status === 'taken'
                ? 'bg-[#e8f5e9] border-[#a5d6a7]'         // green — taken
                : med.status === 'skipped'
                ? 'bg-[#ffebee] border-[#ef9a9a]'          // light red — skipped
                : med.status === 'due'
                ? 'bg-[#fffef5] border-amber2'             // warm yellow — due
                : 'bg-white border-sand';                  // default — upcoming

              return (
              <div
                key={med._id}
                className={`rounded-[18px] p-5 border-2 shadow-sm flex flex-col gap-3 transition-colors duration-300 ${cardClass}`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-[18px] font-bold text-textDark">{med.name} {med.dosage}</div>
                    <div className="text-xs text-textLight mt-0.5 capitalize">
                      {med.mealTiming} Food • Scheduled: {med.scheduledTimes?.join(', ')}
                    </div>
                  </div>

                  {/* Dynamic Badges — escalation states take priority */}
                  {isMissed && (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#ffcdd2] text-[#b71c1c] animate-pulse">
                      🚨 Missed – Caregiver Alerted
                    </span>
                  )}
                  {isSnoozed && (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#fff9c4] text-[#7a5a10]">
                      ⏰ Snoozed
                    </span>
                  )}
                  {!isMissed && !isSnoozed && med.status === 'taken' && (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#c8e6c9] text-[#2e7d32]">✓ Taken</span>
                  )}
                  {!isMissed && !isSnoozed && med.status === 'skipped' && (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#ffcdd2] text-[#c62828]">✗ Skipped</span>
                  )}
                  {!isMissed && !isSnoozed && med.status === 'due' && (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amberSoft text-[#7a5a10] animate-pulse">● Due Now</span>
                  )}
                  {!isMissed && !isSnoozed && med.status === 'upcoming' && (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">⏳ Upcoming</span>
                  )}
                </div>
                
                <div className="flex gap-2 mt-2">
                  {/* Take / Skip Buttons (Only show if due!) */}
                  {med.status === 'due' && (
                    <>
                      <button 
                        onClick={() => handleStatusUpdate(med._id, 'taken')} 
                        className="flex-1 bg-sage2 text-[#1e3a1d] py-2 rounded-lg font-bold text-sm border-2 border-sage2 hover:bg-sage transition-colors shadow-sm"
                      >
                        ✓ Take
                      </button>
                      <button 
                        onClick={() => handleStatusUpdate(med._id, 'skipped')} 
                        className="flex-1 bg-blush2 text-[#7a2a1a] py-2 rounded-lg font-bold text-sm border-2 border-blush2 hover:bg-blush transition-colors shadow-sm"
                      >
                        ✗ Skip
                      </button>
                    </>
                  )}
                  
                  {/* Edit Button */}
                  <button 
                    onClick={() => openEditModal(med)}
                    className="flex-[0.5] bg-white border-2 border-sky2 text-[#2c658a] py-2 rounded-lg font-bold text-sm hover:bg-[#f0f7fc] transition-colors shadow-sm"
                    title="Edit Medication"
                  >
                    ✏️ Edit
                  </button>

                  {/* Cancel Button */}
                  <button 
                    onClick={() => handleDelete(med._id)}
                    className="flex-[0.5] bg-white border-2 border-gray-200 text-gray-500 py-2 rounded-lg font-bold text-sm hover:bg-gray-50 transition-colors shadow-sm"
                    title="Cancel Medication"
                  >
                    🗑️ Cancel
                  </button>
                </div>
              </div>
              );
            })}
            {/* END OF MAP LOOP */}

          </div>
        )}

      </div>

      {/* ── My Doctor Slide-In Panel ─────────────────────────────────────────── */}
      {/* Backdrop */}
      {isDoctorPanelOpen && (
        <div
          className="fixed inset-0 bg-[#2d2418]/40 backdrop-blur-sm z-40"
          onClick={() => setIsDoctorPanelOpen(false)}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-[480px] bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out ${
          isDoctorPanelOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-sand bg-gradient-to-r from-[#fae8d8] to-[#f0dded]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center shadow-sm">
              <span className="text-xl">🩺</span>
            </div>
            <div>
              <h2 className="font-serif text-lg text-brown2 font-semibold leading-tight">My Doctor</h2>
              <p className="text-xs text-textLight">Link physician &amp; automate monthly reports</p>
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
          <DoctorSettings />
        </div>
      </div>

      {/* --- ADD MEDICINE MODAL --- */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-[#2d2418]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] p-8 w-full max-w-lg shadow-2xl">
            <h2 className="font-serif text-2xl text-brown2 mb-6">Add New Medication</h2>
            {/* Change accept="image/*,application/pdf" to strictly images */}
            <input type="file" accept="image/png, image/jpeg" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
            <button type="button" onClick={() => fileInputRef.current.click()} disabled={isScanning} className="w-full mb-6 py-4 rounded-xl border-2 border-dashed border-sky3 bg-[#f0f7fc] text-sky3 font-bold flex items-center justify-center gap-2 hover:bg-[#e0f0fa] transition-colors disabled:opacity-70">
              {isScanning ? 'Analyzing Prescription...' : '📷 Scan Prescription (Auto-Fill)'}
            </button>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Medicine Name</label>
                  <input type="text" required value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" placeholder="e.g. Crocin" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Dosage</label>
                  <input type="text" required value={formData.dosage} onChange={(e) => setFormData({...formData, dosage: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" placeholder="e.g. 500mg" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Frequency</label>
                  <select value={formData.frequency} onChange={(e) => setFormData({...formData, frequency: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="once">Once Daily</option>
                    <option value="twice">Twice Daily</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Time</label>
                  <input type="time" required value={formData.time} onChange={(e) => setFormData({...formData, time: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Meal Timing</label>
                  <select value={formData.mealTiming} onChange={(e) => setFormData({...formData, mealTiming: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="before">Before Food</option>
                    <option value="after">After Food</option>
                    <option value="any">Anytime</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Pill Stock</label>
                  <input type="number" required value={formData.tabletCount} onChange={(e) => setFormData({...formData, tabletCount: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" placeholder="30" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Alert Method</label>
                  <select value={notificationType} onChange={(e) => setNotificationType(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="sms">SMS Text Message</option>
                    <option value="call">Automated Voice Call</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-[2] bg-brown2 text-white py-3 rounded-lg font-bold hover:bg-[#4a3628]">Schedule & Save</button>
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 bg-white border-2 border-sand text-textDark py-3 rounded-lg font-bold hover:bg-cream">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- EDIT MEDICINE MODAL --- */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-[#2d2418]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] p-8 w-full max-w-lg shadow-2xl">
            <h2 className="font-serif text-2xl text-brown2 mb-6">Edit Medication</h2>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Medicine Name</label>
                  <input type="text" required value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Dosage</label>
                  <input type="text" required value={formData.dosage} onChange={(e) => setFormData({...formData, dosage: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Frequency</label>
                  <select value={formData.frequency} onChange={(e) => setFormData({...formData, frequency: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="once">Once Daily</option>
                    <option value="twice">Twice Daily</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Time</label>
                  <input type="time" required value={formData.time} onChange={(e) => setFormData({...formData, time: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Meal Timing</label>
                  <select value={formData.mealTiming} onChange={(e) => setFormData({...formData, mealTiming: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="before">Before Food</option>
                    <option value="after">After Food</option>
                    <option value="any">Anytime</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Pill Stock</label>
                  <input type="number" required value={formData.tabletCount} onChange={(e) => setFormData({...formData, tabletCount: e.target.value})} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block text-[13px] font-bold text-textLight mb-1">Alert Method</label>
                  <select value={notificationType} onChange={(e) => setNotificationType(e.target.value)} className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg">
                    <option value="sms">SMS Text Message</option>
                    <option value="call">Automated Voice Call</option>
                  </select>
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