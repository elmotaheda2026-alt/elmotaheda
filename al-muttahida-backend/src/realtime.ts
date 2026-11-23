import crypto from 'crypto';
import type { Request, Response } from 'express';

const NODE_ID = crypto.randomUUID();
const sseClients = new Set<Response>();

let sqlDb: any = null;
let lastSeenSeq = 0;
let sqlPollTimer: ReturnType<typeof setInterval> | null = null;
let lastCleanupAt = 0;
let isPollingSql = false;

function broadcastLocalSse(entity: string, action = 'update', id?: string): void {
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

export async function initRealtimeSqlSync(db: any): Promise<void> {
  sqlDb = db;
  try {
    await db.run(`
      IF OBJECT_ID('realtime_events', 'U') IS NULL
      CREATE TABLE realtime_events (
        seq BIGINT IDENTITY(1,1) PRIMARY KEY,
        node_id NVARCHAR(64) NOT NULL,
        entity NVARCHAR(64) NOT NULL,
        action NVARCHAR(64) NOT NULL,
        record_id NVARCHAR(128) NULL,
        created_at BIGINT NOT NULL
      );
    `);

    const row = await db.get(
      'SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM realtime_events'
    );
    lastSeenSeq = Number(row?.maxSeq || 0);
  } catch {
    // Ignore transient setup error; poll loop retries if DB recovers
  }

  if (sqlPollTimer) return;

  sqlPollTimer = setInterval(async () => {
    if (isPollingSql || !sqlDb || sseClients.size === 0) return;
    isPollingSql = true;
    try {
      const rows = await sqlDb.all(
        `SELECT seq, node_id, entity, action, record_id
         FROM realtime_events
         WHERE seq > ?
         ORDER BY seq ASC`,
        lastSeenSeq
      );
      if (Array.isArray(rows) && rows.length > 0) {
        for (const r of rows) {
          const seqNum = Number(r.seq || 0);
          if (seqNum > lastSeenSeq) lastSeenSeq = seqNum;
          if (r.node_id && r.node_id !== NODE_ID) {
            broadcastLocalSse(String(r.entity), String(r.action || 'update'), r.record_id || undefined);
          }
        }
      }

      const now = Date.now();
      if (now - lastCleanupAt > 60000) {
        lastCleanupAt = now;
        await sqlDb.run('DELETE FROM realtime_events WHERE created_at < ?', now - 120000);
      }
    } catch {
      // Ignore transient poll errors
    } finally {
      isPollingSql = false;
    }
  }, 1200);
}

export function stopRealtimeSqlSync(): void {
  if (sqlPollTimer) {
    clearInterval(sqlPollTimer);
    sqlPollTimer = null;
  }
}

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
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 8000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

export function broadcastDataChange(entity: string, action = 'update', id?: string): void {
  broadcastLocalSse(entity, action, id);
  if (sqlDb) {
    void sqlDb
      .run(
        `INSERT INTO realtime_events (node_id, entity, action, record_id, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        NODE_ID,
        entity,
        action,
        id || null,
        Date.now()
      )
      .catch(() => {});
  }
}

export function getConnectedSseCount(): number {
  return sseClients.size;
}
