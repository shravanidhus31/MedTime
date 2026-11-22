import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { setCredentials } from '../redux/authSlice';
import api from '../utils/api';
import AuthLayout from '../components/ui/AuthLayout';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const navigate = useNavigate();
  const useDispatchhook = useDispatch();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await api.post('/auth/login', { phone, password });
      
      // Dispatch to Redux store (#11: include refreshToken)
      useDispatchhook(setCredentials({
        user: response.data.user,
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken
      }));

      // Route based on role
      if (response.data.user.role === 'patient') {
        navigate('/patient');
      } else if (response.data.user.role === 'caregiver') {
        navigate('/caregiver');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to connect to the server.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in with your phone number.">

        <form onSubmit={handleLogin} className="space-y-6">
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
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full px-4 py-3 text-sm font-semibold text-white bg-[#2f6f5e] rounded-full hover:bg-[#255a4c] focus:outline-none focus:ring-2 focus:ring-[#2f6f5e]/30 focus:ring-offset-1 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-[#66756f]">
          Don't have an account?{' '}
          <Link to="/register" className="font-semibold text-[#2f6f5e] hover:text-[#255a4c]">
            Sign up
          </Link>
        </div>
    </AuthLayout>
  );
}
