import React from 'react';
import { Navigate } from 'react-router-dom';

const PublicRoute = ({ children }) => {
  const storedUser = localStorage.getItem('user');
  
  // If user is already logged in, send them to their dashboard
  if (storedUser && storedUser !== 'null' && storedUser !== 'undefined') {
    return <Navigate to="/reports" replace />;
  }

  return children;
};

export default PublicRoute;
