import React from 'react';
import { Navigate } from 'react-router-dom';
import RaedRedirect from './RaedRedirect';
import { expireSessionAfterCloseGrace } from './sessionTimeout';

const PublicRoute = ({ children, allowStaffHome = false }) => {
  expireSessionAfterCloseGrace();

  let user;
  try {
    user = JSON.parse(sessionStorage.getItem('user'));
  } catch {
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('idamag_auth_version');
  }

  const sessionVersion = sessionStorage.getItem('idamag_auth_version');
  if (sessionVersion !== '2') {
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('idamag_auth_version');
    return children;
  }

  if (user?.id && user.role === 'RAED') {
    return <RaedRedirect />;
  }

  if (user?.id && user.role === 'Admin') {
    return <Navigate to="/reports" replace />;
  }

  if (user?.id && user.role === 'Staff' && !allowStaffHome) {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default PublicRoute;
