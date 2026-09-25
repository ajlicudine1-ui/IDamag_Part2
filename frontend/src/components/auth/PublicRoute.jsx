import React from 'react';
import { Navigate } from 'react-router-dom';

const PublicRoute = ({ children }) => {
  let user;
  try {
    user = JSON.parse(localStorage.getItem('user'));
  } catch {
    localStorage.removeItem('user');
  }
  if (user?.id && ['Admin', 'Staff'].includes(user.role)) {
    return <Navigate to={user.role === 'Admin' ? '/reports' : '/'} replace />;
  }
  return children;
};

export default PublicRoute;
