import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

const router = Router();
router.use(requireAuth);

const guarantorSchema = z.object({
  name: z.string().default(''),
  address: z.string().default(''),
  nationalId: z.string().default(''),
  phone: z.string().default(''),
  relationship: z.string().default(''),
}).nullable();

const customerSchema = z.object({
  customerNumber: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().min(1),
  gender: z.enum(['male', 'female']),
  city: z.string().min(1),
  governorate: z.string().min(1),
  region: z.string().min(1),
  dateOfBirth: z.string().min(1),
  nationalId: z.string().min(1),
  age: z.number().int(),
  pensionDate: z.string().default(''),
  balance: z.number().default(0),
  balanceType: z.enum(['debtor', 'creditor']).default('debtor'),
  notes: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  guarantors: z.array(guarantorSchema).length(3).optional().nullable(),
  isSued: z.boolean().optional().default(false),
  suedDate: z.string().optional().nullable(),
});

// GET /customers
router.get('/', requirePermission('sales:read'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM customers ORDER BY created_at DESC');
    const mapped = rows.map((row: any) => ({
      ...row,
      age: Number(row.age),
      balance: Number(row.balance),
      isSued: row.is_sued === 1 || row.is_sued === true,
      guarantors: row.guarantors ? JSON.parse(row.guarantors) : [null, null, null],
      customerNumber: row.customer_number,
      balanceType: row.balance_type,
      dateOfBirth: row.date_of_birth,
      nationalId: row.national_id,
      pensionDate: row.pension_date,
      suedDate: row.sued_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /customers
router.post('/', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid customer payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const id = uid();
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    await db.run(
      `INSERT INTO customers (
        id, customer_number, name, phone, email, address, gender, city, governorate, region,
        date_of_birth, national_id, age, pension_date, balance, balance_type,
        notes, image, guarantors, is_sued, sued_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.customerNumber,
      data.name,
      data.phone,
      data.email || null,
      data.address,
      data.gender,
      data.city,
      data.governorate,
      data.region,
      data.dateOfBirth,
      data.nationalId,
      data.age,
      data.pensionDate,
      data.balance,
      data.balanceType,
      data.notes || null,
      data.image || null,
      data.guarantors ? JSON.stringify(data.guarantors) : null,
      data.isSued ? 1 : 0,
      data.suedDate || null,
      now,
      now,
    );

    await audit('customer.create', 'customer', id, req.user?.name || 'system', data);
    return res.status(201).json({ id, customerNumber: data.customerNumber });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE')) {
      return res.status(409).json({ message: 'رقم العميل مسجل بالفعل لنظام آخر' });
    }
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /customers/:id
router.put('/:id', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid customer payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM customers WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    await db.run(
      `UPDATE customers
       SET customer_number = ?, name = ?, phone = ?, email = ?, address = ?, gender = ?,
           city = ?, governorate = ?, region = ?, date_of_birth = ?, national_id = ?, age = ?,
           pension_date = ?, balance = ?, balance_type = ?, notes = ?,
           image = ?, guarantors = ?, is_sued = ?, sued_date = ?, updated_at = ?
       WHERE id = ?`,
      data.customerNumber,
      data.name,
      data.phone,
      data.email || null,
      data.address,
      data.gender,
      data.city,
      data.governorate,
      data.region,
      data.dateOfBirth,
      data.nationalId,
      data.age,
      data.pensionDate,
      data.balance,
      data.balanceType,
      data.notes || null,
      data.image || null,
      data.guarantors ? JSON.stringify(data.guarantors) : null,
      data.isSued ? 1 : 0,
      data.suedDate || null,
      now,
      req.params.id,
    );

    await audit('customer.update', 'customer', req.params.id, req.user?.name || 'system', data);
    return res.json({ message: 'Customer updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /customers/:id
router.delete('/:id', requirePermission('users:manage'), async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM customers WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    await db.run('DELETE FROM customers WHERE id = ?', req.params.id);
    await audit('customer.delete', 'customer', req.params.id, req.user?.name || 'system', { id: req.params.id });
    return res.json({ message: 'Customer deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
