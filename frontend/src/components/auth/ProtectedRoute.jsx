import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { expireSessionAfterCloseGrace } from './sessionTimeout';

const ProtectedRoute = ({ children, requiresAdmin = false }) => {
  const location = useLocation();
  expireSessionAfterCloseGrace();
  let user;
  try {
    user = JSON.parse(sessionStorage.getItem('user'));
  } catch {
    sessionStorage.removeItem('user');
  }

  const sessionVersion = sessionStorage.getItem('idamag_auth_version');
  if (sessionVersion !== '2' || !user || !user.id || !['Admin', 'Staff'].includes(user.role)) {
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('idamag_auth_version');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (requiresAdmin && user.role !== 'Admin') {
    return <Navigate to="/" replace />;
  }
  return children;
};

export default ProtectedRoute;
