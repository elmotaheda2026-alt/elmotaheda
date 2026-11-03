import fs from 'fs';
import path from 'path';
import os from 'os';
import { exportBackup, generateSqlBackup } from './routes/backup.js';

export interface AutoBackupConfig {
  enabled: boolean;
  destinationPath: string;
  frequency: 'daily' | 'twice_daily' | 'hourly';
  backupTime: string; // e.g. "23:00"
  retentionDays: number;
  lastBackupAt: string | null;
  lastBackupStatus: 'success' | 'failed' | null;
  lastBackupFileName: string | null;
  lastBackupError?: string | null;
}

const DEFAULT_CONFIG: AutoBackupConfig = {
  enabled: true,
  destinationPath: 'D:\\AlMuttahida_Backups',
  frequency: 'daily',
  backupTime: '23:00',
  retentionDays: 30,
  lastBackupAt: null,
  lastBackupStatus: null,
  lastBackupFileName: null,
};

function getLocalDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getConfigFilePath(): string {
  const baseDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const appDir = path.join(baseDir, 'Al-Muttahida ERP');
  try {
    if (!fs.existsSync(appDir)) {
      fs.mkdirSync(appDir, { recursive: true });
    }
    return path.join(appDir, 'auto-backup-config.json');
  } catch (_) {
    return path.join(process.cwd(), 'auto-backup-config.json');
  }
}

export function getAutoBackupConfig(): AutoBackupConfig {
  try {
    const cfgPath = getConfigFilePath();
    if (fs.existsSync(cfgPath)) {
      const data = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch (err: any) {
    console.warn('[AutoBackup] Error reading auto-backup-config.json:', err.message);
  }
  return { ...DEFAULT_CONFIG };
}

export function updateAutoBackupConfig(changes: Partial<AutoBackupConfig>): AutoBackupConfig {
  const current = getAutoBackupConfig();
  const merged: AutoBackupConfig = {
    ...current,
    ...changes,
  };

  try {
    const cfgPath = getConfigFilePath();
    fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[AutoBackup] Failed to save auto-backup-config.json:', err.message);
  }

  return merged;
}

export function resolveDestinationPath(configuredPath: string): string {
  let targetPath = (configuredPath || '').trim();
  if (!targetPath) {
    targetPath = 'D:\\AlMuttahida_Backups';
  }

  // On Windows, verify drive existence
  if (process.platform === 'win32') {
    const driveLetter = targetPath.slice(0, 2).toUpperCase();
    if (/^[A-Z]:$/.test(driveLetter)) {
      try {
        if (!fs.existsSync(driveLetter + '\\')) {
          if (fs.existsSync('D:\\')) {
            targetPath = 'D:\\AlMuttahida_Backups';
          } else if (fs.existsSync('E:\\')) {
            console.warn(`[AutoBackup] Drive ${driveLetter}\\ not found. Using secondary drive E:\\AlMuttahida_Backups`);
            targetPath = 'E:\\AlMuttahida_Backups';
          } else {
            console.warn(`[AutoBackup] Drive ${driveLetter}\\ not found. Defaulting to C:\\AlMuttahida_Backups`);
            targetPath = 'C:\\AlMuttahida_Backups';
          }
        }
      } catch (_) {
        targetPath = 'C:\\AlMuttahida_Backups';
      }
    }
  }

  return targetPath;
}

function hasBackupForDate(destDir: string, dateStr: string): boolean {
  try {
    if (!fs.existsSync(destDir)) return false;
    const files = fs.readdirSync(destDir);
    return files.some((f) => f.startsWith(`backup_${dateStr}`) && f.endsWith('.sql'));
  } catch (_) {
    return false;
  }
}

function generateBackupFileName(destDir: string): string {
  const now = new Date();
  const dateStr = getLocalDateString(now);
  const baseName = `backup_${dateStr}.sql`;
  const candidatePath = path.join(destDir, baseName);

  if (!fs.existsSync(candidatePath)) {
    return baseName;
  }

  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `backup_${dateStr}_${hours}-${minutes}.sql`;
}

function cleanOldBackups(destDir: string, retentionDays: number) {
  try {
    if (!fs.existsSync(destDir)) return;
    const files = fs.readdirSync(destDir);
    const backupFiles = files
      .filter((file) => file.startsWith('backup_') && file.endsWith('.sql'))
      .map((file) => {
        const fullPath = path.join(destDir, file);
        const stats = fs.statSync(fullPath);
        return { file, fullPath, mtime: stats.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);

    const maxKeep = Math.max(1, retentionDays || 30);
    if (backupFiles.length > maxKeep) {
      const toDelete = backupFiles.slice(maxKeep);
      for (const item of toDelete) {
        try {
          fs.unlinkSync(item.fullPath);
          console.log(`[AutoBackup Retention] Deleted old backup: ${item.file}`);
        } catch (e: any) {
          console.warn(`[AutoBackup Retention] Failed to delete ${item.file}:`, e.message);
        }
      }
    }
  } catch (err: any) {
    console.warn('[AutoBackup Retention] Cleanup warning:', err.message);
  }
}

function getExpectedScheduledTime(config: AutoBackupConfig): Date {
  const now = new Date();
  const [h, m] = (config.backupTime || '23:00').split(':').map(Number);
  const scheduledToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 0, m || 0, 0, 0);

  if (now.getTime() >= scheduledToday.getTime()) {
    return scheduledToday;
  } else {
    // Last expected scheduled run was yesterday at backupTime
    return new Date(scheduledToday.getTime() - 24 * 3600 * 1000);
  }
}

export async function performAutoBackup(reason = 'Scheduled'): Promise<{
  success: boolean;
  filePath?: string;
  fileName?: string;
  error?: string;
}> {
  console.log(`[AutoBackup] Starting automated database backup (${reason})...`);
  const config = getAutoBackupConfig();
  const targetDir = resolveDestinationPath(config.destinationPath);

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Export system database
    const backupData = await exportBackup();
    const sqlContent = generateSqlBackup(backupData);

    const fileName = generateBackupFileName(targetDir);
    const filePath = path.join(targetDir, fileName);

    fs.writeFileSync(filePath, sqlContent, 'utf-8');

    // Run retention policy
    cleanOldBackups(targetDir, config.retentionDays);

    // Update config status
    updateAutoBackupConfig({
      lastBackupAt: new Date().toISOString(),
      lastBackupStatus: 'success',
      lastBackupFileName: fileName,
      lastBackupError: null,
    });

    console.log(`[AutoBackup] Successfully saved ${fileName} to ${targetDir}`);
    return {
      success: true,
      filePath,
      fileName,
    };
  } catch (err: any) {
    console.error(`[AutoBackup] Backup failed:`, err);
    updateAutoBackupConfig({
      lastBackupStatus: 'failed',
      lastBackupError: err.message || String(err),
    });
    return {
      success: false,
      error: err.message || String(err),
    };
  }
}

/**
 * Strategy 1: On-Startup Catch-up Mechanism
 * Verifies if a daily backup already exists for today.
 * If the computer was turned off during the scheduled time and no backup exists for today,
 * it immediately triggers a backup in the background.
 */
export async function runStartupCatchupCheck(): Promise<void> {
  const config = getAutoBackupConfig();
  if (!config.enabled) {
    console.log('[AutoBackup Startup Check] Auto backup is disabled in settings.');
    return;
  }

  const targetDir = resolveDestinationPath(config.destinationPath);
  const now = new Date();
  const todayDateStr = getLocalDateString(now);

  // Check 1: Does a backup file for today ALREADY exist in the destination folder?
  const todayBackupExists = hasBackupForDate(targetDir, todayDateStr);
  if (todayBackupExists) {
    console.log(`[AutoBackup Startup Check] Today's backup already exists in ${targetDir} (${todayDateStr}). No catch-up needed.`);
    return;
  }

  // Check 2: Was the computer off during the scheduled time, or is there no backup for today?
  const lastExpectedTime = getExpectedScheduledTime(config);
  const lastBackupAt = config.lastBackupAt ? new Date(config.lastBackupAt) : null;

  let isMissed = false;
  let catchupReason = '';

  if (!lastBackupAt) {
    isMissed = true;
    catchupReason = 'On-Startup catch-up: Initial database backup (no previous backup found)';
  } else if (lastBackupAt.getTime() < lastExpectedTime.getTime()) {
    isMissed = true;
    catchupReason = `On-Startup catch-up: Missed scheduled backup at ${lastExpectedTime.toLocaleString('ar-EG')} (Computer was turned off)`;
  } else {
    // If last backup was taken yesterday but today has no backup and scheduled time hasn't passed yet,
    // wait for today's scheduled time.
    console.log(`[AutoBackup Startup Check] Last backup was on ${lastBackupAt.toLocaleString('ar-EG')}. Today's scheduled run is set for ${config.backupTime}.`);
    return;
  }

  if (isMissed) {
    console.log(`[AutoBackup Startup Catch-up] ${catchupReason}. Triggering background backup now...`);
    await performAutoBackup(catchupReason);
  }
}

/**
 * Strategy 2: Scheduled Periodic Check (Runs every 15 minutes)
 * When the scheduled time arrives during normal operation, triggers the daily backup.
 */
async function checkAndRunScheduledBackup(): Promise<void> {
  const config = getAutoBackupConfig();
  if (!config.enabled) return;

  const now = new Date();
  const targetDir = resolveDestinationPath(config.destinationPath);

  if (config.frequency === 'daily') {
    const [targetH, targetM] = (config.backupTime || '23:00').split(':').map(Number);
    const currentH = now.getHours();
    const currentM = now.getMinutes();
    const currentMinutes = currentH * 60 + currentM;
    const targetMinutes = (targetH || 0) * 60 + (targetM || 0);

    // Current time has reached or passed the daily scheduled time
    if (currentMinutes >= targetMinutes) {
      const scheduledToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetH, targetM, 0, 0);
      const lastBackupAt = config.lastBackupAt ? new Date(config.lastBackupAt) : null;

      const alreadyRanScheduledToday = lastBackupAt && lastBackupAt.getTime() >= scheduledToday.getTime();
      if (!alreadyRanScheduledToday) {
        console.log(`[AutoBackup Scheduled] Current time reached scheduled time (${config.backupTime}). Executing daily backup...`);
        await performAutoBackup(`Scheduled daily trigger (${config.backupTime})`);
      }
    }
  } else if (config.frequency === 'twice_daily') {
    const lastBackupAt = config.lastBackupAt ? new Date(config.lastBackupAt) : null;
    if (!lastBackupAt || (now.getTime() - lastBackupAt.getTime() >= 12 * 3600 * 1000)) {
      await performAutoBackup('Twice-daily scheduled trigger');
    }
  } else if (config.frequency === 'hourly') {
    const lastBackupAt = config.lastBackupAt ? new Date(config.lastBackupAt) : null;
    if (!lastBackupAt || (now.getTime() - lastBackupAt.getTime() >= 3600 * 1000)) {
      await performAutoBackup('Hourly scheduled trigger');
    }
  }
}

let schedulerInterval: NodeJS.Timeout | null = null;

export function startAutoBackupScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  console.log('[AutoBackup] Dual-Strategy Auto Backup Scheduler active.');

  // Strategy 1: On-Startup Catch-up Check (runs 5 seconds after server startup)
  setTimeout(() => {
    runStartupCatchupCheck().catch((err) => {
      console.warn('[AutoBackup] Startup catch-up check warning:', err.message);
    });
  }, 5000);

  // Strategy 2: Periodic Scheduler Check (runs every 15 minutes)
  schedulerInterval = setInterval(() => {
    checkAndRunScheduledBackup().catch((err) => {
      console.warn('[AutoBackup] Periodic schedule check warning:', err.message);
    });
  }, 15 * 60 * 1000);
}
