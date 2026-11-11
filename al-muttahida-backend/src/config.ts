import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';

dotenv.config();

/**
 * Returns the base directory for Al-Muttahida ERP settings in %PROGRAMDATA%
 * (fallback to %APPDATA% if PROGRAMDATA is not available).
 */
export function getConfigDir(): string {
  const programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
  return path.join(programData, 'Al-Muttahida ERP');
}

/**
 * Returns the full path to config.json.
 */
export function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Reads and parses the saved configuration.
 * Checks %PROGRAMDATA% first, then falls back to %APPDATA% for backwards compatibility.
 */
export function getSavedConfig(): any {
  try {
    const primaryPath = getConfigFilePath();
    if (fs.existsSync(primaryPath)) {
      const data = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
      return data;
    }

    // Fallback: Check legacy %APPDATA% location
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const legacyPath = path.join(appData, 'Al-Muttahida ERP', 'config.json');
    if (fs.existsSync(legacyPath)) {
      const data = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
      return data;
    }
  } catch (err) {
    // Ignore read errors
  }
  return null;
}

/**
 * Safely saves/merges configuration in %PROGRAMDATA%\Al-Muttahida ERP\config.json
 * Creating the directory recursively if it does not exist.
 */
export function saveAppConfig(newConfig: Record<string, any>): void {
  try {
    const dir = getConfigDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const current = getSavedConfig() || {};
    const merged = { ...current, ...newConfig };
    fs.writeFileSync(getConfigFilePath(), JSON.stringify(merged, null, 2), 'utf8');
  } catch (err) {
    console.warn('Could not save configuration to ProgramData:', err);
  }
}

const saved = getSavedConfig();

export const config = {
  port: Number(process.env.PORT || saved?.port || 4000),
  jwtSecret: process.env.JWT_SECRET || 'AlMuttahida_Secure_Production_JWT_Secret_Key_2026_Fallback',
  sql: {
    server: saved?.lastSuccessfulServer || (saved?.mode === 'client' ? (saved?.host || saved?.db?.host || '127.0.0.1') : (process.env.DB_HOST || '127.0.0.1')),
    port: Number(saved?.port || saved?.db?.port || process.env.DB_PORT || 1433),
    user: process.env.DB_USER || saved?.dbUser || 'alm_app',
    password: process.env.DB_PASSWORD || saved?.dbPassword || 'Alm@2026#App',
    database: saved?.database || saved?.db?.database || process.env.DB_NAME || 'AlMuttahida_New',
    options: {
      encrypt: (process.env.DB_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate: (process.env.DB_TRUST_CERT || 'true').toLowerCase() === 'true',
      ...(saved?.instanceName ? { instanceName: saved.instanceName } : {}),
    },
    pool: {
      max: 50,
      min: 10,
      idleTimeoutMillis: 30000,
      acquireTimeoutMillis: 15000,
    },
    connectionTimeout: 15000,
    requestTimeout: 15000,
    connectionOptions: {
      keepAlive: true,
      keepAliveInitialDelay: 10000,
    },
  },
};
