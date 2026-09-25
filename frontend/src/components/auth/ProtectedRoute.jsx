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

  if (!user || !user.id || !['Admin', 'Staff'].includes(user.role)) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (requiresAdmin && user.role !== 'Admin') {
    return <Navigate to="/" replace />;
  }
  return children;
};

export default ProtectedRoute;
