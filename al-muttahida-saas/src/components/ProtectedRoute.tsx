// src/components/ProtectedRoute.tsx
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Permission } from '../types';
import { getDefaultRouteForUser, hasPermission, isAdmin } from '../lib/permissions';

export default function ProtectedRoute({
  children,
  permission,
  anyPermissions,
  adminOnly,
  fallbackToDefault,
}: {
  children: React.ReactNode;
  permission?: Permission;
  anyPermissions?: Permission[];
  adminOnly?: boolean;
  fallbackToDefault?: boolean;
}) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (adminOnly && !isAdmin(user)) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700 font-bold text-center">
        لا تملك صلاحية الوصول لهذه الصفحة.
      </div>
    );
  }
  const hasRequiredPermission = permission
    ? hasPermission(user, permission)
    : anyPermissions && anyPermissions.length > 0
      ? anyPermissions.some((p) => hasPermission(user, p))
      : true;

  if (!hasRequiredPermission) {
    if (fallbackToDefault) {
      const target = getDefaultRouteForUser(user);
      if (target !== '/') {
        return <Navigate to={target} replace />;
      }
    }
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-700 font-bold text-center">
        لا تملك صلاحية الوصول لهذه الصفحة.
      </div>
    );
  }
  return <>{children}</>;
}
