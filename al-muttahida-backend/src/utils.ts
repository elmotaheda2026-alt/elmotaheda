import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { Permission } from './types.js';

export function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: { userId: string; role: string; name: string; permissions?: Permission[] }) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '12h' });
}
