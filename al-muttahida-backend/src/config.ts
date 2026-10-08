import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';

dotenv.config();

function getSavedConfig() {
  try {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const configFile = path.join(appData, 'Al-Muttahida ERP', 'config.json');
    if (fs.existsSync(configFile)) {
      const data = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      return data;
    }
  } catch (err) {
    // ignore
  }
  return null;
}

const saved = getSavedConfig();

export const config = {
  port: Number(process.env.PORT || saved?.port || 4000),
  // Ensure a strong JWT secret is provided via env var
  jwtSecret: process.env.JWT_SECRET || 'AlMuttahida_Secure_Production_JWT_Secret_Key_2026_Fallback',
  sql: {
    server: saved?.host || saved?.db?.host || process.env.DB_HOST || '127.0.0.1',
    port: Number(saved?.port || saved?.db?.port || process.env.DB_PORT || 1433),
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    database: saved?.database || saved?.db?.database || process.env.DB_NAME || 'AlMuttahida_New',
    options: {
      encrypt: (process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate: (process.env.DB_TRUST_CERT || 'true').toLowerCase() === 'true',
    },
    // Connection pool settings to prevent deadlocks and pool exhaustion
    pool: {
      max: 50,
      min: 10, // Keep 10 connections alive at all times to prevent cold start latency
      idleTimeoutMillis: 30000, // idle timeout of 30 seconds
      acquireTimeoutMillis: 15000,
    },
    connectionTimeout: 15000,
    requestTimeout: 15000, // Query timeout cap at 15 seconds
    // Add extra options for connection reliability
    connectionOptions: {
      keepAlive: true,
      keepAliveInitialDelay: 10000,
    },
  },
};
