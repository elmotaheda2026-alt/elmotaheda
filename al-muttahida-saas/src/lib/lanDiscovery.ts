/**
 * Fast LAN Scanner to locate active Al-Muttahida Backend server instances on local subnets.
 */
export async function scanLanForServer(port = 4000, timeoutMs = 800): Promise<string | null> {
  const candidateSubnets = ['192.168.1', '192.168.0', '192.168.100', '10.0.0'];

  // Probe candidates in parallel batches
  for (const subnet of candidateSubnets) {
    const promises: Array<Promise<string | null>> = [];

    for (let i = 1; i <= 254; i++) {
      const targetIp = `${subnet}.${i}`;
      const url = `http://${targetIp}:${port}/health`;

      const probePromise = (async (): Promise<string | null> => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(id);
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
      })();

      promises.push(probePromise);
    }

    const results = await Promise.all(promises);
    const found = results.find((res) => res !== null);
    if (found) {
      return found;
    }
  }

  return null;
}
