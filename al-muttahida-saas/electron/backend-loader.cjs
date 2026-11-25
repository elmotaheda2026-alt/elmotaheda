/**
 * Backend Loader - Starts the Express backend server inside the Electron app.
 */
const { fork, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

let backendProcess = null;
let isStopping = false;

function getAppDataDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'Al-Muttahida ERP');
}

/**
 * Find the backend entry point.
 */
function getBackendPath() {
  const candidates = [];

  // Packaged extraResources
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'backend', 'server.bundle.cjs'));
    candidates.push(path.join(process.resourcesPath, 'backend', 'server.js'));
    candidates.push(path.join(process.resourcesPath, 'backend', 'dist', 'server.bundle.cjs'));
    candidates.push(path.join(process.resourcesPath, 'backend', 'dist', 'server.js'));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'server.js'));
  }

  // Development paths
  candidates.push(path.join(__dirname, '..', '..', 'al-muttahida-backend', 'dist', 'server.bundle.cjs'));
  candidates.push(path.join(__dirname, '..', '..', 'al-muttahida-backend', 'dist', 'server.js'));
  candidates.push(path.join(__dirname, '..', 'backend', 'server.bundle.cjs'));
  candidates.push(path.join(__dirname, '..', 'backend', 'server.js'));

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return p;
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Find the backend .env file path
 */
function getBackendEnvPath() {
  const candidates = [];

  if (process.resourcesPath) {
    const exeDir = path.dirname(process.execPath);
    candidates.push(path.join(exeDir, '.env'));
    candidates.push(path.join(process.resourcesPath, 'backend', '.env'));
  }

  candidates.push(path.join(__dirname, '..', '..', 'al-muttahida-backend', '.env'));

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }

  return null;
}

/**
 * Check if backend is healthy
 */
function checkHealth(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      if (res.statusCode === 200) {
        resolve();
      } else {
        reject(new Error(`Health check status: ${res.statusCode}`));
      }
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Health check timeout'));
    });
  });
}

/**
 * Start the backend server
 * @returns {Promise<number>} The port the backend is listening on
 */
let startBackendPromise = null;
let consecutiveCrashRestarts = 0;

function startBackend() {
  if (startBackendPromise) return startBackendPromise;
  isStopping = false;
  startBackendPromise = new Promise(async (resolve, reject) => {
    // Check if backend is ALREADY running on port 4000
    try {
      await checkHealth('http://127.0.0.1:4000/health');
      console.log('Backend is already running and healthy on port 4000.');
      return resolve(4000);
    } catch (_) {
      // Not running, proceed to spawn
    }

    const backendPath = getBackendPath();
    if (!backendPath) {
      return reject(new Error('Could not find backend server files. Expected server.js in resources/backend.'));
    }

    // Prepare log directory with automatic size-capped rotation (max 5 MB active + 5 MB previous)
    const logDir = path.join(getAppDataDir(), 'logs');
    try {
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    } catch (_) {}
    const logFilePath = path.join(logDir, 'backend.log');
    const prevLogFilePath = path.join(logDir, 'backend.old.log');
    const MAX_LOG_BYTES = 5 * 1024 * 1024;
    let approxLogBytes = 0;
    try {
      if (fs.existsSync(logFilePath)) {
        const stat = fs.statSync(logFilePath);
        approxLogBytes = stat.size;
        if (stat.size >= MAX_LOG_BYTES) {
          try { if (fs.existsSync(prevLogFilePath)) fs.unlinkSync(prevLogFilePath); } catch (_) {}
          fs.renameSync(logFilePath, prevLogFilePath);
          approxLogBytes = 0;
        }
      }
    } catch (_) {}

    const env = {
      PORT: '4000',
      DB_HOST: '127.0.0.1',
      DB_PORT: '1433',
      DB_USER: 'alm_app',
      DB_PASSWORD: 'Alm@2026#App',
      DB_NAME: 'AlMuttahida_New',
      DB_ENCRYPT: 'false',
      DB_TRUST_CERT: 'true',
      ALLOW_SEED: 'false',
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    };

    // Read .env file first as base defaults
    const envPath = getBackendEnvPath();
    if (envPath) {
      try {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex > 0) {
              const key = trimmed.substring(0, eqIndex).trim();
              let value = trimmed.substring(eqIndex + 1).trim();
              if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
              }
              env[key] = value;
            }
          }
        });
      } catch (err) {
        console.warn('Could not read .env file:', err.message);
      }
    }

    // Load config.json if present (overrides .env defaults; check %PROGRAMDATA% first, then %APPDATA%)
    const configCandidates = [
      path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Al-Muttahida ERP', 'config.json'),
      path.join(getAppDataDir(), 'config.json'),
    ];
    for (const appConfigFile of configCandidates) {
      try {
        if (fs.existsSync(appConfigFile)) {
          const raw = fs.readFileSync(appConfigFile, 'utf-8').replace(/^\uFEFF/, '');
          const parsed = JSON.parse(raw);
          if (parsed.host || parsed.lastSuccessfulServer) {
            env.DB_HOST = parsed.host || parsed.lastSuccessfulServer;
          }
          if (parsed.dbPort && Number(parsed.dbPort) !== 4000) {
            env.DB_PORT = String(parsed.dbPort);
          } else {
            env.DB_PORT = '1433';
          }
          if (parsed.dbUser) env.DB_USER = parsed.dbUser;
          if (parsed.dbPassword) env.DB_PASSWORD = parsed.dbPassword;
          if (parsed.database) env.DB_NAME = parsed.database;
          break;
        }
      } catch (err) {
        console.warn('Could not read config.json:', err.message);
      }
    }

    const port = Number(env.PORT || 4000);
    console.log(`Starting backend from: ${backendPath} on port ${port}`);

    // Spawn process using Electron executable with ELECTRON_RUN_AS_NODE=1
    try {
      backendProcess = fork(backendPath, [], {
        env,
        cwd: path.dirname(backendPath),
        silent: true,
      });
    } catch (spawnErr) {
      return reject(new Error(`Failed to spawn backend process: ${spawnErr.message}`));
    }

    let started = false;
    const stderrLogs = [];

    let rotatingLog = false;
    const appendLog = (msg) => {
      const line = `[${new Date().toISOString()}] ${msg}\n`;
      approxLogBytes += Buffer.byteLength(line, 'utf8');
      if (approxLogBytes >= MAX_LOG_BYTES && !rotatingLog) {
        rotatingLog = true;
        try {
          if (fs.existsSync(prevLogFilePath)) fs.unlinkSync(prevLogFilePath);
          if (fs.existsSync(logFilePath)) fs.renameSync(logFilePath, prevLogFilePath);
          approxLogBytes = Buffer.byteLength(line, 'utf8');
        } catch (_) {
        } finally {
          rotatingLog = false;
        }
      }
      fs.appendFile(logFilePath, line, () => {});
    };

    backendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Backend]', output);
      appendLog(`STDOUT: ${output}`);
      if (!started && output.includes('listening')) {
        started = true;
        resolve(port);
      }
    });

    backendProcess.stderr.on('data', (data) => {
      const errStr = data.toString();
      console.error('[Backend Error]', errStr);
      appendLog(`STDERR: ${errStr}`);
      stderrLogs.push(errStr);
    });

    backendProcess.on('error', (err) => {
      appendLog(`ERROR: ${err.message}`);
      if (!started) reject(err);
    });

    backendProcess.on('exit', (code) => {
      appendLog(`EXIT: code ${code}`);
      console.log(`Backend process exited with code ${code}`);
      backendProcess = null;
      if (!started) {
        const details = stderrLogs.slice(-5).join(' ').trim();
        reject(new Error(`Backend process exited with code ${code}${details ? `: ${details}` : ''}`));
      } else if (!isStopping) {
        consecutiveCrashRestarts += 1;
        if (consecutiveCrashRestarts <= 5) {
          const delayMs = Math.min(10000, 1500 * consecutiveCrashRestarts);
          appendLog(`WARN: Backend exited unexpectedly after startup; scheduling auto-restart (${consecutiveCrashRestarts}/5) in ${delayMs}ms`);
          setTimeout(() => {
            if (!isStopping) {
              startBackend().catch((restartErr) => {
                appendLog(`ERROR: Auto-restart failed: ${restartErr.message}`);
              });
            }
          }, delayMs);
        } else {
          appendLog('ERROR: Max backend auto-restart attempts (5) reached; manual intervention required.');
        }
      }
    });

    // Actively poll health check every 400ms up to 25 seconds
    const startTime = Date.now();
    const interval = setInterval(async () => {
      if (started) {
        clearInterval(interval);
        return;
      }

      if (Date.now() - startTime > 25000) {
        clearInterval(interval);
        if (!started) {
          const details = stderrLogs.slice(-5).join(' ').trim();
          reject(new Error(`Backend failed to become healthy within 25s${details ? `: ${details}` : ''}`));
        }
        return;
      }

      try {
        await checkHealth(`http://127.0.0.1:${port}/health`);
        if (!started) {
          started = true;
          consecutiveCrashRestarts = 0;
          clearInterval(interval);
          resolve(port);
        }
      } catch (_) {
        // Still initializing, keep waiting
      }
    }, 400);
  }).finally(() => {
    startBackendPromise = null;
  });
}

/**
 * Ensure the backend server is alive and healthy (restarts if dropped during sleep).
 */
async function ensureBackendRunning(port = 4000) {
  if (isStopping) return;
  try {
    await checkHealth(`http://127.0.0.1:${port}/health`);
  } catch (_) {
    await startBackend();
  }
}

/**
 * Stop the backend server
 */
function stopBackend() {
  isStopping = true;
  if (backendProcess) {
    try {
      if (backendProcess.send) {
        backendProcess.send('shutdown');
      }
    } catch (_) {}
    try {
      if (process.platform === 'win32' && backendProcess.pid) {
        const { execSync } = require('child_process');
        execSync(`taskkill /F /T /PID ${backendProcess.pid}`, { stdio: 'ignore' });
      } else {
        backendProcess.kill();
      }
    } catch (_) {}
    backendProcess = null;
  }

  // Also verify and terminate any orphan process holding port 4000 to prevent zombie processes
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      const stdout = execSync('netstat -ano -p tcp', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      const lines = stdout.split('\r\n');
      for (const line of lines) {
        if (line.includes(':4000') && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && pid !== '0' && pid !== String(process.pid)) {
            try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }); } catch (_) {}
          }
        }
      }
    } catch (_) {}
  }
}

module.exports = { startBackend, stopBackend, checkHealth, ensureBackendRunning, getAppDataDir };
