import dgram from 'dgram';
import os from 'os';
import { config } from './config.js';

function getLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

export function startDiscoveryService(udpPort = 4001): void {
  const server = dgram.createSocket('udp4');

  server.on('error', (err) => {
    console.warn('UDP Discovery Service error:', err.message);
  });

  server.on('message', (msg, rinfo) => {
    const messageStr = msg.toString().trim();
    if (messageStr === 'ALMUTTAHIDA_DISCOVERY_PING' || messageStr.includes('ALMUTTAHIDA_PING')) {
      const localIps = getLocalIpAddresses();
      const primaryIp = localIps[0] || '127.0.0.1';

      const responsePayload = JSON.stringify({
        service: 'al-muttahida-backend',
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
