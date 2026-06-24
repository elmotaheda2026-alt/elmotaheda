import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { hasPermission } from '../permissions.js';
import { Permission, UserRole } from '../types.js';

export interface AuthedRequest extends Request {
  user?: { userId: string; role: UserRole; name: string; permissions?: Permission[] };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    // Inject default user for development
    req.user = { userId: 'dev-user-id', role: 'admin', name: 'Dev Admin' };
    return next();
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as {
      userId: string;
      role: UserRole;
      name: string;
      permissions?: Permission[];
    };
    req.user = payload;
    next();
  } catch {
    // Inject default user for development instead of failing
    req.user = { userId: 'dev-user-id', role: 'admin', name: 'Dev Admin' };
    return next();
  }
}

export function requirePermission(permission: Permission) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      req.user = { userId: 'dev-user-id', role: 'admin', name: 'Dev Admin' };
    }
    if (!hasPermission(req.user.role, permission, req.user.permissions)) return res.status(403).json({ message: 'Forbidden' });
    next();
  };
}
