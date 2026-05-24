import { dbPromise } from './db.js';
import { uid } from './utils.js';

export async function audit(action: string, entityType: string, entityId: string, createdBy: string, payload?: unknown) {
  const db = await dbPromise;
  await db.run(
    `INSERT INTO audit_log (id, action, entity_type, entity_id, payload, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    uid(),
    action,
    entityType,
    entityId,
    payload ? JSON.stringify(payload) : null,
    createdBy,
    new Date().toISOString(),
  );
}
