import type { Request, Response } from 'express';

const sseClients = new Set<Response>();

export function subscribeSseClient(req: Request, res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseClients.add(res);
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, clients: sseClients.size, ts: Date.now() })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

export function broadcastDataChange(entity: string, action = 'update', id?: string): void {
  if (sseClients.size === 0) return;
  const payload = `event: data-change\ndata: ${JSON.stringify({ entity, action, id, ts: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function getConnectedSseCount(): number {
  return sseClients.size;
}
