import React, { useState, useEffect } from 'react';
// Change your top imports to include useSelector
import { useSelector } from 'react-redux';
import api from '../utils/api'; // Adjust path if needed

export default function VitalsDashboard() {
  const { user } = useSelector((state) => state.auth);
  const [vitals, setVitals] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({ sys: '', dia: '', sugar: '', pulse: '' });

  // Fetch Vitals on Load
  useEffect(() => {
    const fetchVitals = async () => {
      try {
        const response = await api.get('/vitals');
        setVitals(response.data);
      } catch (error) {
        console.error('Failed to fetch vitals', error);
      }
    };
    fetchVitals();
  }, []);

const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await api.post('/vitals', {
        ...formData,
        patientName: user?.name,
        

      });
      
      setVitals([response.data.vital, ...vitals]);
      setIsModalOpen(false);
      setFormData({ sys: '', dia: '', sugar: '', pulse: '' });
      alert(`Vitals logged! Status: ${response.data.vital.status}`);
    } catch (error) {
      console.error('Failed to log vitals', error);
    }
  };

  // Get the most recent reading for the Snapshot cards
  const latest = vitals.length > 0 ? vitals[0] : null;

  return (
    <div className="min-h-screen bg-cream text-textDark font-sans pb-12">
      
      {/* Top Nav placeholder (Keep your existing one here) */}
      <nav className="sticky top-0 z-40 bg-white border-b border-sand px-8 h-[68px] flex items-center shadow-sm">
        <h1 className="font-serif text-xl text-brown2 font-medium">MedTime Vitals</h1>
      </nav>

      <div className="max-w-6xl mx-auto px-8 mt-10">
        
        <div className="flex justify-between items-center mb-8">
          <h2 className="font-serif text-3xl text-brown2">Health Metrics Log</h2>
          <button onClick={() => setIsModalOpen(true)} className="bg-brown2 text-white px-6 py-3 rounded-xl font-bold hover:bg-[#4a3628] transition-colors">
            + Log Vitals
          </button>
        </div>

        {/* LATEST SNAPSHOT CARDS */}
        {latest && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            <div className="bg-white rounded-2xl p-6 border-2 border-sand shadow-sm">
              <div className="text-[11px] font-bold text-textLight uppercase tracking-wider mb-2">Latest Blood Pressure</div>
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-4xl text-brown2">{latest.sys}/{latest.dia}</span>
                <span className="text-sm font-bold text-textLight">mmHg</span>
              </div>
<div className={`mt-4 inline-block px-3 py-1 rounded-full text-xs font-bold 
                ${latest.status === 'Normal' ? 'bg-[#c8e6c9] text-[#2e7d32]' : 
                  latest.status === 'Elevated' ? 'bg-[#ffebee] text-[#c62828]' : 
                  'bg-[#ffcdd2] text-[#c62828] animate-pulse'}`}>
                {latest.status === 'Normal' ? '✓ Normal Range' : `⚠ ${latest.status}`}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 border-2 border-sand shadow-sm">
              <div className="text-[11px] font-bold text-textLight uppercase tracking-wider mb-2">Latest Blood Sugar</div>
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-4xl text-brown2">{latest.sugar || '--'}</span>
                <span className="text-sm font-bold text-textLight">mg/dL</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 border-2 border-sand shadow-sm">
              <div className="text-[11px] font-bold text-textLight uppercase tracking-wider mb-2">Latest Heart Rate</div>
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-4xl text-brown2">{latest.pulse || '--'}</span>
                <span className="text-sm font-bold text-textLight">bpm</span>
              </div>
            </div>
          </div>
        )}

        {/* HISTORICAL TABLE */}
        <div className="bg-white rounded-2xl p-8 border-2 border-sand shadow-sm">
          <h3 className="font-serif text-xl text-brown2 mb-6">Historical Log</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  <th className="pb-4 text-[11px] font-bold text-textLight uppercase border-b-2 border-cream w-[25%]">Date & Time</th>
                  <th className="pb-4 text-[11px] font-bold text-textLight uppercase border-b-2 border-cream w-[25%]">Blood Pressure</th>
                  <th className="pb-4 text-[11px] font-bold text-textLight uppercase border-b-2 border-cream w-[20%]">Blood Sugar</th>
                  <th className="pb-4 text-[11px] font-bold text-textLight uppercase border-b-2 border-cream w-[15%]">Pulse</th>
                  <th className="pb-4 text-[11px] font-bold text-textLight uppercase border-b-2 border-cream w-[15%]">Status</th>
                </tr>
              </thead>
              <tbody>
                {vitals.map((v) => (
                  <tr key={v._id} className="hover:bg-cream transition-colors">
                    <td className="py-4 border-b border-cream text-sm">{new Date(v.recordedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className="py-4 border-b border-cream font-bold">{v.sys}/{v.dia} mmHg</td>
                    <td className="py-4 border-b border-cream">{v.sugar ? `${v.sugar} mg/dL` : '-'}</td>
                    <td className="py-4 border-b border-cream">{v.pulse ? `${v.pulse} bpm` : '-'}</td>
                    <td className="py-4 border-b border-cream">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold
                        ${v.status === 'Normal' ? 'bg-[#e8f5e9] text-[#2e7d32]' : 
                          v.status === 'Elevated' ? 'bg-[#ffebee] text-[#c62828]' : 
                          'bg-[#ffebee] text-[#c62828]'}`}>
                        {v.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* ADD VITALS MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-[#2d2418]/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] p-8 w-full max-w-lg shadow-2xl">
            <h2 className="font-serif text-2xl text-brown2 mb-6">Log Health Vitals</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">BP (Systolic - Top)</label>
                  <input type="number" required value={formData.sys} onChange={(e) => setFormData({...formData, sys: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-sand rounded-xl" placeholder="120" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">BP (Diastolic - Bottom)</label>
                  <input type="number" required value={formData.dia} onChange={(e) => setFormData({...formData, dia: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-sand rounded-xl" placeholder="80" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Blood Sugar (Optional)</label>
                  <input type="number" value={formData.sugar} onChange={(e) => setFormData({...formData, sugar: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-sand rounded-xl" placeholder="mg/dL" />
                </div>
                <div>
                  <label className="block text-[13px] font-bold text-textLight mb-1">Heart Rate (Optional)</label>
                  <input type="number" value={formData.pulse} onChange={(e) => setFormData({...formData, pulse: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-sand rounded-xl" placeholder="bpm" />
                </div>
              </div>
              <div className="flex gap-3 pt-6">
                <button type="submit" className="flex-[2] bg-brown2 text-white py-3 rounded-xl font-bold hover:bg-[#4a3628]">Save Vitals</button>
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 bg-white border-2 border-sand text-textDark py-3 rounded-xl font-bold hover:bg-cream">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}