import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

const ProtectedRoute = ({ children, requiresAdmin = false }) => {
  const location = useLocation();
  let user;
  try {
    user = JSON.parse(localStorage.getItem('user'));
  } catch {
    localStorage.removeItem('user');
  }

  const sessionVersion = localStorage.getItem('idamag_auth_version');
  if (sessionVersion !== '2' || !user || !user.id || !['Admin', 'Staff'].includes(user.role)) {
    localStorage.removeItem('user');
    localStorage.removeItem('idamag_auth_version');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (requiresAdmin && user.role !== 'Admin') {
    return <Navigate to="/" replace />;
  }
  return children;
};

export default ProtectedRoute;
