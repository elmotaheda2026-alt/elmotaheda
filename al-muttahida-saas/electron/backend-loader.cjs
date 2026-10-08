/**
 * Backend Loader - Starts the Express backend server inside the Electron app.
 */
const { fork, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

let backendProcess = null;

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
    candidates.push(path.join(process.resourcesPath, 'backend', 'server.js'));
    candidates.push(path.join(process.resourcesPath, 'backend', 'dist', 'server.js'));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'server.js'));
  }

  // Development paths
  candidates.push(path.join(__dirname, '..', '..', 'al-muttahida-backend', 'dist', 'server.js'));
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
function startBackend() {
  return new Promise(async (resolve, reject) => {
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

    // Prepare log directory
    const logDir = path.join(getAppDataDir(), 'logs');
    try {
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    } catch (_) {}
    const logFilePath = path.join(logDir, 'backend.log');

    const env = {
      PORT: '4000',
      JWT_SECRET: 'AlMuttahida_Secure_Production_JWT_Secret_Key_2026_Fallback',
      DB_HOST: '127.0.0.1',
      DB_PORT: '1433',
      DB_USER: 'sa',
      DB_PASSWORD: '',
      DB_NAME: 'AlMuttahida_New',
      DB_ENCRYPT: 'false',
      DB_TRUST_CERT: 'true',
      ALLOW_SEED: 'false',
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    };

    // Load config.json if present
    const appConfigFile = path.join(getAppDataDir(), 'config.json');
    try {
      if (fs.existsSync(appConfigFile)) {
        const parsed = JSON.parse(fs.readFileSync(appConfigFile, 'utf-8'));
        if (parsed.host) env.DB_HOST = parsed.host;
        if (parsed.port) env.DB_PORT = String(parsed.port);
        if (parsed.database) env.DB_NAME = parsed.database;
      }
    } catch (err) {
      console.warn('Could not read config.json:', err.message);
    }

    // Read .env file if present
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

    const appendLog = (msg) => {
      try {
        fs.appendFileSync(logFilePath, `[${new Date().toISOString()}] ${msg}\n`);
      } catch (_) {}
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
      if (!started) {
        const details = stderrLogs.slice(-5).join(' ').trim();
        reject(new Error(`Backend process exited with code ${code}${details ? `: ${details}` : ''}`));
      }
      backendProcess = null;
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
          clearInterval(interval);
          resolve(port);
        }
      } catch (_) {
        // Still initializing, keep waiting
      }
    }, 400);
  });
}

/**
 * Stop the backend server
 */
function stopBackend() {
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch (_) {}
    backendProcess = null;
  }
}

module.exports = { startBackend, stopBackend, checkHealth, getAppDataDir };
