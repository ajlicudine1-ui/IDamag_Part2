import React from 'react';
import { Navigate } from 'react-router-dom';
import { expireSessionAfterCloseGrace } from './sessionTimeout';

const PublicRoute = ({ children, allowStaffHome = false }) => {
  expireSessionAfterCloseGrace();

  let user;
  try {
    user = JSON.parse(localStorage.getItem('user'));
  } catch {
    localStorage.removeItem('user');
  }

  const sessionVersion = localStorage.getItem('idamag_auth_version');
  if (sessionVersion !== '2') {
    localStorage.removeItem('user');
    localStorage.removeItem('idamag_auth_version');
    return children;
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
