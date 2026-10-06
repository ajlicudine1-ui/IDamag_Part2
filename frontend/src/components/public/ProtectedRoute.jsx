import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import RaedRedirect from './RaedRedirect';
import { expireSessionAfterCloseGrace } from './sessionTimeout';

const ProtectedRoute = ({ children, requiresAdmin = false }) => {
  const location = useLocation();
  expireSessionAfterCloseGrace();

  let user;
  try {
    user = JSON.parse(sessionStorage.getItem('user'));
  } catch {
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('idamag_auth_version');
  }

  const sessionVersion = sessionStorage.getItem('idamag_auth_version');
  if (sessionVersion !== '2' || !user?.id || !['Admin', 'Staff', 'RAED'].includes(user.role)) {
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('idamag_auth_version');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user.role === 'RAED') {
    return <RaedRedirect />;
  }

  if (requiresAdmin && user.role !== 'Admin') {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default ProtectedRoute;
