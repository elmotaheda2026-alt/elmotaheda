import { Router } from 'express';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

const router = Router();

function getNetworkAddresses(): { primary: string; all: string[] } {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  let best = '';

  for (const name of Object.keys(interfaces)) {
    const isVirtual = /vEthernet|VirtualBox|VMware|Loopback/i.test(name);
    const netList = interfaces[name] || [];
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
        if (!best || (!isVirtual && /vEthernet|VirtualBox|VMware/i.test(best))) {
          best = net.address;
        }
      }
    }
  }

  return {
    primary: best || '127.0.0.1',
    all: addresses.length ? addresses : ['127.0.0.1'],
  };
}

function getConfigPath(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Al-Muttahida ERP', 'config.json');
}

function readConfig(): any {
  try {
    const file = getConfigPath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function writeConfig(data: any): void {
  const file = getConfigPath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// GET /network-info (or /system/network-info, /api/system/network-info)
router.get('/network-info', (_req, res) => {
  try {
    const net = getNetworkAddresses();
    const saved = readConfig();

    res.json({
      ok: true,
      localIp: net.primary,
      allIps: net.all,
      hostname: os.hostname(),
      dbConfig: saved || {
        mode: 'server',
        db: {
          host: config.sql.server,
          port: config.sql.port,
          database: config.sql.database,
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /db-config
router.get('/db-config', (_req, res) => {
  try {
    const saved = readConfig();
    res.json({ ok: true, config: saved });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /db-config
router.post('/db-config', (req, res) => {
  try {
    const { host, port, database, mode } = req.body;
    const current = readConfig() || {};
    const updated = {
      ...current,
      mode: mode || current.mode || 'client',
      host: host || current.host || '127.0.0.1',
      port: Number(port) || current.port || 1433,
      database: database || current.database || 'AlMuttahida_New',
      db: {
        host: host || current.host || '127.0.0.1',
        port: Number(port) || current.port || 1433,
        database: database || current.database || 'AlMuttahida_New',
      },
      updatedAt: new Date().toISOString(),
    };
    writeConfig(updated);
    res.json({ ok: true, message: 'Configuration saved successfully', config: updated });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
