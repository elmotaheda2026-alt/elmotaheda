/**
 * Backend Loader - Starts the Express backend server inside the Electron app.
 * Used only in "server" mode.
 */
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

let backendProcess = null;

/**
 * Find the backend entry point.
 * In development: uses the compiled dist from the backend project.
 * In production (packaged): uses the bundled backend in extraResources.
 */
function getBackendPath() {
  const isProd = !process.env.NODE_ENV || process.env.NODE_ENV === 'production';

  if (isProd) {
    // In packaged app, backend is in resources/backend/
    const resourcePath = process.resourcesPath;
    const backendEntry = path.join(resourcePath, 'backend', 'server.js');
    if (fs.existsSync(backendEntry)) return backendEntry;
    // Fallback
    const altPath = path.join(resourcePath, 'backend', 'src', 'server.js');
    if (fs.existsSync(altPath)) return altPath;
  }

  // Development: use the backend dist directly
  const devPath = path.join(__dirname, '..', '..', 'al-muttahida-backend', 'dist', 'server.js');
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

/**
 * Find the backend .env file path
 */
function getBackendEnvPath() {
  const isProd = !process.env.NODE_ENV || process.env.NODE_ENV === 'production';

  if (isProd) {
    // In packaged app, .env is alongside the exe or in resources
    const exeDir = path.dirname(process.execPath);
    const envInExeDir = path.join(exeDir, '.env');
    if (fs.existsSync(envInExeDir)) return envInExeDir;

    const envInResources = path.join(process.resourcesPath, 'backend', '.env');
    if (fs.existsSync(envInResources)) return envInResources;
  }

  // Development
  const devEnv = path.join(__dirname, '..', '..', 'al-muttahida-backend', '.env');
  if (fs.existsSync(devEnv)) return devEnv;

  return null;
}

/**
 * Start the backend server
 * @returns {Promise<number>} The port the backend is listening on
 */
function startBackend() {
  return new Promise((resolve, reject) => {
    const backendPath = getBackendPath();

    if (!backendPath) {
      reject(new Error('Could not find backend server files. Make sure the backend is built.'));
      return;
    }

    const envPath = getBackendEnvPath();
    const env = { ...process.env };

    // Read .env file manually if it exists
    if (envPath) {
      try {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex > 0) {
              const key = trimmed.substring(0, eqIndex).trim();
              let value = trimmed.substring(eqIndex + 1).trim();
              // Remove surrounding quotes
              if ((value.startsWith('"') && value.endsWith('"')) || 
                  (value.startsWith("'") && value.endsWith("'"))) {
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

    const port = env.PORT || 4000;

    console.log(`Starting backend from: ${backendPath}`);
    console.log(`Backend port: ${port}`);

    backendProcess = fork(backendPath, [], {
      env,
      cwd: path.dirname(backendPath),
      silent: true,
    });

    let started = false;

    backendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Backend]', output);
      if (!started && output.includes('listening')) {
        started = true;
        resolve(Number(port));
      }
    });

    backendProcess.stderr.on('data', (data) => {
      console.error('[Backend Error]', data.toString());
    });

    backendProcess.on('error', (err) => {
      if (!started) reject(err);
    });

    backendProcess.on('exit', (code) => {
      console.log(`Backend process exited with code ${code}`);
      if (!started) reject(new Error(`Backend exited with code ${code}`));
      backendProcess = null;
    });

    // Timeout: if backend doesn't start in 15 seconds, try health check
    setTimeout(() => {
      if (!started) {
        checkHealth(`http://127.0.0.1:${port}/health`)
          .then(() => {
            started = true;
            resolve(Number(port));
          })
          .catch(() => {
            // Give it more time (another 15s)
            setTimeout(() => {
              if (!started) {
                checkHealth(`http://127.0.0.1:${port}/health`)
                  .then(() => { started = true; resolve(Number(port)); })
                  .catch(() => reject(new Error('Backend failed to start within 30 seconds')));
              }
            }, 15000);
          });
      }
    }, 15000);
  });
}

/**
 * Check if backend is healthy
 */
function checkHealth(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      if (res.statusCode === 200) resolve();
      else reject(new Error(`Health check returned ${res.statusCode}`));
    }).on('error', reject);
  });
}

/**
 * Stop the backend server
 */
function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

module.exports = { startBackend, stopBackend, checkHealth };
