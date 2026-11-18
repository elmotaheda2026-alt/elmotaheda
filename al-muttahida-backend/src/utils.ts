import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { Permission } from './types.js';

export function uid() {
  return crypto.randomUUID();
}

export async function isPeriodClosed(db: any, dateStr: string): Promise<boolean> {
  if (!dateStr) return false;
  const day = String(dateStr).slice(0, 10);
  const month = String(dateStr).slice(0, 7);
  const closed = await db.get(
    `SELECT 1 FROM closing_periods 
     WHERE status = 'closed' 
       AND ((period_type = 'daily' AND period_date = ?) OR (period_type = 'monthly' AND period_date = ?))`,
    day,
    month
  );
  return !!closed;
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

export function formatDate(dateStr?: string | null): string {
  if (!dateStr || dateStr === 'null' || dateStr === 'undefined') return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime()) || date.getFullYear() === 1970) return '';
  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'long' });
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
}

export function formatDateDisplay(dateStr?: string | null): string {
  if (!dateStr || dateStr === 'null' || dateStr === 'undefined') return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime()) || date.getFullYear() === 1970) return '';
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

