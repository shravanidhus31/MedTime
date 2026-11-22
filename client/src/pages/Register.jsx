import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setCredentials } from '../redux/authSlice';
import api from '../utils/api';
import AuthLayout from '../components/ui/AuthLayout';
import { User, HeartHandshake } from 'lucide-react';

export default function Register() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('patient'); // 'patient' | 'caregiver'
  const [emergencyContact, setEmergencyContact] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const navigate = useNavigate();
  const dispatch = useDispatch();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setIsLoading(true);

    try {
      // 1. Register the user
      await api.post('/auth/register', {
        name,
        phone,
        password,
        role,
        ...(role === 'patient' && emergencyContact ? { emergencyContact } : {})
      });

      // 2. Automatically log them in for a seamless onboarding experience
      const loginRes = await api.post('/auth/login', { phone, password });

      dispatch(setCredentials({
        user: loginRes.data.user,
        accessToken: loginRes.data.accessToken,
        refreshToken: loginRes.data.refreshToken,
      }));

      // 3. Navigate to their respective dashboard
      if (role === 'patient') {
        navigate('/patient');
      } else {
        navigate('/caregiver');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle="For the person taking the medicines, or a family member who cares for them.">

        {/* Role Selector Tabs */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-[#1c2b26] mb-2">I am registering as:</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRole('patient')}
              className={`py-3 px-4 rounded-lg text-sm font-medium border flex items-center justify-center gap-2 transition-all ${
                role === 'patient'
                  ? 'bg-[#e3f2ea] border-blue-600 text-[#2f6f5e] shadow-sm'
                  : 'bg-[#f7faf8] border-[#e2e9e5] text-gray-600 hover:bg-gray-100'
              }`}
            >
              <User size={18} /> Patient
            </button>
            <button
              type="button"
              onClick={() => setRole('caregiver')}
              className={`py-3 px-4 rounded-lg text-sm font-medium border flex items-center justify-center gap-2 transition-all ${
                role === 'caregiver'
                  ? 'bg-amber-50 border-amber-600 text-amber-800 shadow-sm'
                  : 'bg-[#f7faf8] border-[#e2e9e5] text-gray-600 hover:bg-gray-100'
              }`}
            >
              <HeartHandshake size={18} /> Caregiver
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {role === 'patient'
              ? 'Receive phone/SMS medication reminders and manage your schedule.'
              : 'Monitor a family member, manage their access, and approve changes.'}
          </p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#1c2b26]">Full Name</label>
            <input
              type="text"
              required
              className="w-full px-4 py-3 mt-1 text-[#1c2b26] bg-[#f7faf8] border border-[#e2e9e5] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2f6f5e]/30 focus:bg-white transition-colors"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Eleanor Vance"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1c2b26]">Phone Number</label>
            <input
              type="tel"
              required
              className="w-full px-4 py-3 mt-1 text-[#1c2b26] bg-[#f7faf8] border border-[#e2e9e5] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2f6f5e]/30 focus:bg-white transition-colors"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 9876543210"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#1c2b26]">Password</label>
            <input
              type="password"
              required
              className="w-full px-4 py-3 mt-1 text-[#1c2b26] bg-[#f7faf8] border border-[#e2e9e5] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2f6f5e]/30 focus:bg-white transition-colors"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
            />
          </div>

          {role === 'patient' && (
            <div>
              <label className="block text-sm font-medium text-[#1c2b26]">
                Emergency Contact Phone <span className="text-xs font-normal text-gray-400">(Optional)</span>
              </label>
              <input
                type="tel"
                className="w-full px-4 py-3 mt-1 text-[#1c2b26] bg-[#f7faf8] border border-[#e2e9e5] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#2f6f5e]/30 focus:bg-white transition-colors"
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
                placeholder="e.g. 9876543211"
              />
            </div>
          )}

          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full px-4 py-3 text-sm font-semibold text-white bg-[#2f6f5e] rounded-full hover:bg-[#255a4c] focus:outline-none focus:ring-2 focus:ring-[#2f6f5e]/30 focus:ring-offset-1 transition-colors disabled:opacity-50 mt-2"
          >
            {isLoading ? 'Creating account...' : `Sign Up as ${role === 'patient' ? 'Patient' : 'Caregiver'}`}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-[#66756f]">
          Already have an account?{' '}
          <Link to="/" className="font-semibold text-[#2f6f5e] hover:text-[#255a4c]">
            Sign in
          </Link>
        </div>
    </AuthLayout>
  );
}
