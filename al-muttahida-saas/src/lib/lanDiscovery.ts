/**
 * Fast LAN Scanner to locate active Al-Muttahida Backend server instances on local subnets.
 */
export async function scanLanForServer(port = 4000, timeoutMs = 800): Promise<string | null> {
  // Quick check 1: current hostname if running on LAN
  if (typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    try {
      const res = await fetch(`http://${window.location.hostname}:${port}/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return `http://${window.location.hostname}:${port}`;
    } catch {
      // Probe next candidate
    }
  }

  // Quick check 2: localhost
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) });
    if (res.ok) return `http://127.0.0.1:${port}`;
  } catch {
    // Probe LAN subnets
  }

  const candidateSubnets = ['192.168.1', '192.168.0', '192.168.100', '10.0.0'];
  const BATCH_SIZE = 25;

  // Probe candidates in bounded concurrency batches to avoid saturating browser socket limits
  for (const subnet of candidateSubnets) {
    for (let start = 1; start <= 254; start += BATCH_SIZE) {
      const batchPromises: Array<Promise<string | null>> = [];
      const end = Math.min(254, start + BATCH_SIZE - 1);

      for (let i = start; i <= end; i++) {
        const targetIp = `${subnet}.${i}`;
        const url = `http://${targetIp}:${port}/health`;

        batchPromises.push(
          (async (): Promise<string | null> => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            try {
              const res = await fetch(url, { signal: controller.signal });
              if (res.ok) {
                const data = await res.json();
                if (data?.service === 'al-muttahida-backend' || data?.ok === true) {
                  return `http://${targetIp}:${port}`;
                }
              }
            } catch {
              // Timeout or connection refused
            } finally {
              clearTimeout(id);
            }
            return null;
          })(),
        );
      }

      const results = await Promise.all(batchPromises);
      const found = results.find((res) => res !== null);
      if (found) {
        return found;
      }
    }
  }

  return null;
}
