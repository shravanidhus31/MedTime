import React, { useState, useRef, useEffect } from 'react';
import { useSelector } from 'react-redux';
import api from '../utils/api';

export default function PatientDashboard() {
  const { user } = useSelector((state) => state.auth);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const fileInputRef = useRef(null);
  
  // State to hold medicines from the database
  const [medicines, setMedicines] = useState([]);
  const [notificationType, setNotificationType] = useState('sms');

  // Form State (Added 'time' field)
  const [formData, setFormData] = useState({
    name: '',
    dosage: '',
    frequency: 'once',
    time: '08:00', // Default time
    mealTiming: 'any',
    tabletCount: ''
  });

  // Fetch medicines when the dashboard loads
// Fetch medicines when the dashboard loads AND every 5 seconds
  useEffect(() => {
    const fetchMedicines = async () => {
      try {
        const response = await api.get('/medicines');
        setMedicines(response.data);
      } catch (error) {
        console.error('Failed to fetch medicines:', error);
      }
    };
    
    fetchMedicines(); // Initial fetch
    
    // Set up the auto-polling
    const interval = setInterval(fetchMedicines, 5000); 
    
    // Clean up the interval when the user leaves the page
    return () => clearInterval(interval);
  }, []);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsScanning(true);
    
    setTimeout(() => {
      setFormData({
        name: 'Crocin',
        dosage: '500mg',
        frequency: 'once',
        time: '14:00', // 2:00 PM
        mealTiming: 'after',
        tabletCount: '30'
      });
      setIsScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }, 2500);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Send data to backend, converting 'time' into the array our DB expects
      const response = await api.post('/medicines', {
        ...formData,
        scheduledTimes: [formData.time],
        type: 'tablet',
        startDate: new Date(), // <-- Fixed missing comma here!
        notificationType: notificationType
      });
      
      // Update UI instantly with the newly saved medicine
      setMedicines([...medicines, response.data.medicine]);
      setIsModalOpen(false);
      
      // Reset form and dropdown
      setFormData({ name: '', dosage: '', frequency: 'once', time: '08:00', mealTiming: 'any', tabletCount: '' });
      setNotificationType('sms');
    } catch (error) {
      console.error('Failed to save medicine:', error);
    }
  };

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
        </div>

        <button className="flex items-center gap-2 bg-[#fff0ef] border-[1.5px] border-rose text-[#c0392b] rounded-lg px-4 py-2 font-bold transition-transform hover:scale-105">
          <span className="w-2 h-2 rounded-full bg-rose animate-pulse"></span>
          SOS
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
        
        {/* Dynamic Dose Checklist */}
        <h2 className="font-serif text-2xl text-brown2 mb-4">Your Active Prescriptions</h2>
        
        {medicines.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-xl border border-dashed border-sand">
            <p className="text-textLight">No medicines added yet. Click "Add Medicine" to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {medicines.map((med) => (
              <div key={med._id} className="bg-[#fffef5] rounded-[18px] p-5 border-2 border-amber2 shadow-sm flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-[18px] font-bold text-textDark">{med.name} {med.dosage}</div>
                    <div className="text-xs text-textLight mt-0.5 capitalize">
                      {med.mealTiming} Food • Scheduled: {med.scheduledTimes?.join(', ')}
                    </div>
                  </div>
                  
                  {/* --- DYNAMIC BADGE --- */}
                  {med.status === 'taken' ? (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#e8f5e9] text-[#2e7d32]">
                      ✓ Taken
                    </span>
                  ) : med.status === 'skipped' ? (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#ffebee] text-[#c62828]">
                      ✗ Skipped
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-amberSoft text-[#7a5a10] animate-pulse">
                      ● Due Now
                    </span>
                  )}
                </div>
                
                {/* --- DYNAMIC BUTTONS (Only show if NOT taken or skipped) --- */}
                {med.status !== 'taken' && med.status !== 'skipped' && (
                  <div className="flex gap-2 mt-2">
                    <button 
                      onClick={() => console.log('Take clicked')}
                      className="flex-1 bg-sage2 text-[#1e3a1d] py-2 rounded-lg font-bold text-sm border-2 border-sage2 hover:bg-sage transition-colors"
                    >
                      ✓ Take Now
                    </button>
                    <button 
                      onClick={() => console.log('Skip clicked')}
                      className="flex-1 bg-blush2 text-[#7a2a1a] py-2 rounded-lg font-bold text-sm border-2 border-blush2 hover:bg-blush transition-colors"
                    >
                      ✗ Skip
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

      {/* ADD MEDICINE MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-[#2d2418]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] p-8 w-full max-w-lg shadow-2xl">
            <h2 className="font-serif text-2xl text-brown2 mb-6">Add New Medication</h2>
            
            <input type="file" accept="image/*,application/pdf" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />

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
                  <select 
                    value={notificationType}
                    onChange={(e) => setNotificationType(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-sand rounded-lg"
                  >
                    <option value="sms">SMS Text Message</option>
                    <option value="call">Automated Voice Call</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-[2] bg-brown2 text-white py-3 rounded-lg font-bold hover:bg-[#4a3628]">
                  Schedule & Save
                </button>
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 bg-white border-2 border-sand text-textDark py-3 rounded-lg font-bold hover:bg-cream">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  </div>
  );
}