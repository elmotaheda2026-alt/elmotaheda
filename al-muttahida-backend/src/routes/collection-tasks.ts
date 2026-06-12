import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

const router = Router();
router.use(requireAuth);

const collectionTaskSchema = z.object({
  customerId: z.string().min(1),
  customerName: z.string().min(1),
  saleId: z.string().min(1),
  installmentId: z.string().min(1),
  dueDate: z.string().min(8),
  amount: z.number().positive(),
  status: z.enum(['open', 'visited', 'collected', 'failed', 'cancelled']).default('open'),
  assignedToUserId: z.string().optional().nullable(),
  assignedToName: z.string().optional().nullable(),
  visitNotes: z.string().optional().nullable(),
  visitResult: z.string().optional().nullable(),
});

// GET /collection-tasks
router.get('/', async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    let query = 'SELECT * FROM collection_tasks';
    const params: any[] = [];

    // Collectors can only see tasks assigned to them
    if (req.user?.role === 'collector') {
      query += ' WHERE assigned_to_user_id = ?';
      params.push(req.user.userId);
    }
    
    query += ' ORDER BY due_date ASC, created_at DESC';

    const rows = await db.all(query, ...params);
    const mapped = rows.map((row: any) => ({
      id: row.id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      saleId: row.sale_id,
      installmentId: row.installment_id,
      dueDate: row.due_date,
      amount: Number(row.amount),
      status: row.status,
      assignedToUserId: row.assigned_to_user_id,
      assignedToName: row.assigned_to_name,
      visitNotes: row.visit_notes,
      visitResult: row.visit_result,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /collection-tasks
router.post('/', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const parsed = collectionTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid collection task payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const id = uid();
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    await db.run(
      `INSERT INTO collection_tasks (
        id, customer_id, customer_name, sale_id, installment_id, due_date, amount, status,
        assigned_to_user_id, assigned_to_name, visit_notes, visit_result, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.customerId,
      data.customerName,
      data.saleId,
      data.installmentId,
      data.dueDate,
      data.amount,
      data.status,
      data.assignedToUserId || null,
      data.assignedToName || null,
      data.visitNotes || null,
      data.visitResult || null,
      now,
      now,
    );

    await audit('collection_task.create', 'collection_task', id, req.user?.name || 'system', data);
    return res.status(201).json({ id });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /collection-tasks/:id
router.put('/:id', async (req: AuthedRequest, res) => {
  const parsed = collectionTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid collection task payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get<{ id: string; assigned_to_user_id: string }>('SELECT id, assigned_to_user_id FROM collection_tasks WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Collection task not found' });
    }

    // A collector can only edit tasks assigned to them
    if (req.user?.role === 'collector' && existing.assigned_to_user_id !== req.user.userId) {
      return res.status(403).json({ message: 'غير مصرح لك بتعديل هذه المهمة' });
    }

    await db.run(
      `UPDATE collection_tasks
       SET customer_id = ?, customer_name = ?, sale_id = ?, installment_id = ?, due_date = ?, amount = ?, status = ?,
           assigned_to_user_id = ?, assigned_to_name = ?, visit_notes = ?, visit_result = ?, updated_at = ?
       WHERE id = ?`,
      data.customerId,
      data.customerName,
      data.saleId,
      data.installmentId,
      data.dueDate,
      data.amount,
      data.status,
      data.assignedToUserId || null,
      data.assignedToName || null,
      data.visitNotes || null,
      data.visitResult || null,
      now,
      req.params.id,
    );

    await audit('collection_task.update', 'collection_task', req.params.id, req.user?.name || 'system', data);
    return res.json({ message: 'Collection task updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /collection-tasks/:id
router.delete('/:id', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM collection_tasks WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Collection task not found' });
    }

    await db.run('DELETE FROM collection_tasks WHERE id = ?', req.params.id);
    await audit('collection_task.delete', 'collection_task', req.params.id, req.user?.name || 'system', { id: req.params.id });
    return res.json({ message: 'Collection task deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
