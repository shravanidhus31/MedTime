import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';

// Pages
import Login from './pages/Login';
import PatientDashboard from './pages/PatientDashboard';
import CaregiverDashboard from './pages/CaregiverDashBoard';

export default function App() {
  // Grab auth state from Redux
  const { isAuthenticated, user } = useSelector((state) => state.auth);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Route */}
        <Route path="/" element={<Login />} />
        
        {/* Protected Routes based on Role */}
        <Route 
          path="/patient" 
          element={
            isAuthenticated && user?.role === 'patient' 
              ? <PatientDashboard /> 
              : <Navigate to="/" />
          } 
        />
        
        <Route 
          path="/caregiver" 
          element={
            isAuthenticated && user?.role === 'caregiver' 
              ? <CaregiverDashboard /> 
              : <Navigate to="/" />
          } 
        />
      </Routes>
    </BrowserRouter>
  );
}