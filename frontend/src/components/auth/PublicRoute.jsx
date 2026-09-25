import React from 'react';
import { Navigate } from 'react-router-dom';

const PublicRoute = ({ children }) => {
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
  if (user?.id && ['Admin', 'Staff'].includes(user.role)) {
    return <Navigate to={user.role === 'Admin' ? '/reports' : '/'} replace />;
  }
  return children;
};

export default PublicRoute;
