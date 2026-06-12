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

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'long' });
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

export function formatDateDisplay(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB');
}

/**
 * Parse a date string in `DD/MM/YYYY` format and return an ISO string.
 * If the input is already a valid ISO date, it will be returned unchanged.
 * Throws an error if the format is invalid.
 */
export function parseDateInput(dateStr: string): string {
  // First, try to parse as ISO (fallback for existing clients)
  const iso = new Date(dateStr);
  if (!isNaN(iso.getTime())) return iso.toISOString();

  const match = /^([0-3]\d)\/([0-1]\d)\/(\d{4})$/.exec(dateStr.trim());
  if (!match) {
    throw new Error('Invalid date format, expected DD/MM/YYYY');
  }
  const [_, day, month, year] = match;
  // Construct ISO string (midnight UTC)
  const isoString = new Date(`${year}-${month}-${day}T00:00:00.000Z`).toISOString();
  return isoString;
}

