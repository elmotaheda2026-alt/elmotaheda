import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { hasPermission } from '../permissions.js';
import { Permission, UserRole } from '../types.js';

export interface AuthedRequest extends Request {
  user?: { userId: string; role: UserRole; name: string; permissions?: Permission[] };
}

const validRoles: UserRole[] = ['admin', 'manager', 'accountant', 'user', 'collector', 'reviewer', 'finance_manager'];
const validPermissions: Permission[] = [
  'sales:read',
  'sales:write',
  'sales:reschedule',
  'payments:read',
  'payments:write',
  'payments:reverse',
  'reports:read',
  'closing:write',
  'users:manage',
  'inventory:manage',
  'purchases:manage',
  'settings:manage',
  'shareholders:manage',
  'notifications:read',
];

function isUserRole(role: unknown): role is UserRole {
  return typeof role === 'string' && validRoles.includes(role as UserRole);
}

function isPermissionArray(permissions: unknown): permissions is Permission[] | undefined {
  return permissions === undefined
    || (Array.isArray(permissions) && permissions.every((permission) => validPermissions.includes(permission)));
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as {
      userId: string;
      role: UserRole;
      name: string;
      permissions?: Permission[];
    };

    if (
      typeof payload.userId !== 'string'
      || !payload.userId
      || !isUserRole(payload.role)
      || typeof payload.name !== 'string'
      || !isPermissionArray(payload.permissions)
    ) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: 'Unauthorized' });
  }
}

export function requirePermission(permission: Permission) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!hasPermission(req.user.role, permission, req.user.permissions)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    return next();
  };
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden' });
  }

  return next();
}
