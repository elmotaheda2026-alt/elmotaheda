import dgram from 'dgram';
import os from 'os';
import { config } from './config.js';

const VIRTUAL_ADAPTER_REGEX = /vEthernet|WSL|VMware|VirtualBox|Hyper-V|Docker|Loopback|ZeroTier|Tailscale|Hamachi|Teredo|Bluetooth/i;

function getLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const preferred: string[] = [];
  const fallback: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const isVirtual = VIRTUAL_ADAPTER_REGEX.test(name);
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        if (!isVirtual) {
          preferred.push(iface.address);
        } else {
          fallback.push(iface.address);
        }
      }
    }
  }
  return [...preferred, ...fallback];
}

function pickBestIpForRequester(localIps: string[], requesterIp: string): string {
  if (localIps.length === 0) return '127.0.0.1';
  const reqParts = String(requesterIp || '').split('.');
  if (reqParts.length === 4) {
    const reqPrefix3 = `${reqParts[0]}.${reqParts[1]}.${reqParts[2]}.`;
    const exactSubnet = localIps.find((ip) => ip.startsWith(reqPrefix3));
    if (exactSubnet) return exactSubnet;
    const reqPrefix2 = `${reqParts[0]}.${reqParts[1]}.`;
    const sameClassB = localIps.find((ip) => ip.startsWith(reqPrefix2));
    if (sameClassB) return sameClassB;
  }
  return localIps[0];
}

export function startDiscoveryService(udpPort = 4001): void {
  const server = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  server.on('error', (err) => {
    console.warn('UDP Discovery Service error:', err.message);
  });

  server.on('message', (msg, rinfo) => {
    const messageStr = msg.toString().trim();
    if (messageStr === 'ALMUTTAHIDA_DISCOVERY_PING' || messageStr.includes('ALMUTTAHIDA_PING')) {
      const localIps = getLocalIpAddresses();
      const primaryIp = pickBestIpForRequester(localIps, rinfo.address);

      const responsePayload = JSON.stringify({
        service: 'al-muttahida-backend',
        hostname: os.hostname(),
        serverIp: primaryIp,
        allIps: localIps,
        port: config.port,
        status: 'online',
        timestamp: new Date().toISOString(),
      });

      const responseBuffer = Buffer.from(responsePayload);
      server.send(responseBuffer, 0, responseBuffer.length, rinfo.port, rinfo.address, (err) => {
        if (err) {
          console.warn(`Failed to reply to UDP discovery ping from ${rinfo.address}:`, err.message);
        }
      });
    }
  });

  server.on('listening', () => {
    const address = server.address();
    console.log(`📡 UDP Server Discovery Listener running on port ${address.port}`);
  });

  try {
    server.bind(udpPort, '0.0.0.0', () => {
      server.setBroadcast(true);
    });
  } catch (err) {
    console.warn('Failed to bind UDP Discovery port:', err);
  }
}
