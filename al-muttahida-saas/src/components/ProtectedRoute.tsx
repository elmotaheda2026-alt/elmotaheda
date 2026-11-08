// src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Permission } from '../types';
import { hasPermission, isAdmin } from '../lib/permissions';

export default function ProtectedRoute({ children, permission, adminOnly }: { children: React.ReactNode; permission?: Permission; adminOnly?: boolean }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (adminOnly && !isAdmin(user) && user?.role !== 'manager') {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700 font-bold text-center">
        لا تملك صلاحية الوصول لهذه الصفحة.
      </div>
    );
  }
  if (permission && !hasPermission(user, permission)) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
        لا تملك صلاحية الوصول لهذه الصفحة.
      </div>
    );
  }
  return <>{children}</>;
}
