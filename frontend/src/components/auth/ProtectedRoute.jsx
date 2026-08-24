import React from 'react';
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children, requiresAdmin = false }) => {
  const storedUserStr = localStorage.getItem('user');
  
  // Safety check: handle null, undefined, or empty session
  if (!storedUserStr || storedUserStr === 'null' || storedUserStr === 'undefined') {
    return <Navigate to="/login" replace />;
  }

  try {
    const user = JSON.parse(storedUserStr);
    
    if (!user) {
      return <Navigate to="/login" replace />;
    }

    if (requiresAdmin && user.role !== 'Admin') {
      return <Navigate to="/reports" replace />;
    }

    return children;
  } catch (error) {
    console.error("Session parsing error:", error);
    localStorage.removeItem('user'); // Clear corrupted session
    return <Navigate to="/login" replace />;
  }
};

export default ProtectedRoute;
