import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import PatientDashboard from './pages/PatientDashboard';
import CaregiverDashboard from './pages/CaregiverDashBoard';
import CaregiverLinkPage from './pages/CaregiverLinkPage';
import CaregiverAccessPage from './pages/CaregiverAccessPage';
import VitalsDashboard from './pages/VitalsDashboard';

export default function App() {
  // Grab auth state from Redux
  const { isAuthenticated, user } = useSelector((state) => state.auth);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<Register />} />
        
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

        {/* Caregiver Link and Access Management Routes (#12) */}
        <Route 
          path="/caregiver/link" 
          element={
            isAuthenticated && user?.role === 'caregiver' 
              ? <CaregiverLinkPage /> 
              : <Navigate to="/" />
          } 
        />

        <Route 
          path="/caregiver/access" 
          element={
            isAuthenticated 
              ? <CaregiverAccessPage /> 
              : <Navigate to="/" />
          } 
        />

        <Route 
          path="/vitals" 
          element={
            isAuthenticated 
              ? <VitalsDashboard /> 
              : <Navigate to="/" />
          } 
        />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
