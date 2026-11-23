import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAdmin, requireAnyPermission, requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid, formatDate } from '../utils.js';
import { broadcastDataChange } from '../realtime.js';

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
  balanceType: z.literal('debtor').default('debtor'),
  notes: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
  idCardFront: z.string().optional().nullable(),
  idCardBack: z.string().optional().nullable(),
  guarantors: z.array(guarantorSchema).length(3).optional().nullable(),
  isSued: z.boolean().optional().default(false),
  suedDate: z.string().optional().nullable(),
});

// GET /customers (lightweight list: omits heavy base64 images; supports optional server-side pagination)
router.get('/', requireAnyPermission('sales:read', 'payments:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const rawPage = typeof req.query.page === 'string' ? Number(req.query.page) : undefined;
    const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const filter = typeof req.query.filter === 'string' ? req.query.filter.trim() : 'all';

    const where: string[] = [];
    const params: any[] = [];

    if (search) {
      where.push('(name LIKE ? OR customer_number LIKE ? OR phone LIKE ? OR national_id LIKE ? OR address LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }

    if (filter === 'debtors') {
      where.push('balance > 0');
    } else if (filter === 'sued') {
      where.push('is_sued = 1');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pagination =
      rawPage && rawLimit
        ? { page: Math.max(1, Math.trunc(rawPage)), limit: Math.min(200, Math.max(1, Math.trunc(rawLimit))) }
        : undefined;

    const baseColumns = `id, customer_number, name, phone, email, address, gender,
              city, governorate, region, date_of_birth, national_id, age,
              pension_date, balance, balance_type, notes, guarantors,
              is_sued, sued_date, created_at, updated_at`;
    const listSql = `SELECT ${baseColumns}
       FROM customers
       ${whereSql}
       ORDER BY created_at DESC, id DESC`;

    const [rows, countRow, statsRow] = pagination
      ? await Promise.all([
          db.all<any>(listSql, params, pagination),
          db.get<{ total: number }>(`SELECT COUNT(*) AS total FROM customers ${whereSql}`, ...params),
          db.get<{
            totalCount: number;
            debtorsCount: number;
            suedCount: number;
            totalReceivables: number;
          }>(`
            SELECT COUNT(*) AS totalCount,
                   SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END) AS debtorsCount,
                   SUM(CASE WHEN is_sued = 1 THEN 1 ELSE 0 END) AS suedCount,
                   COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS totalReceivables
            FROM customers
          `),
        ])
      : [await db.all<any>(listSql, params), null, null];

    const mapped = rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email || null,
      address: row.address,
      gender: row.gender,
      city: row.city || '',
      governorate: row.governorate || '',
      region: row.region || '',
      notes: row.notes || null,
      image: null,
      idCardFront: null,
      idCardBack: null,
      hasImage: false,
      hasIdCardFront: false,
      hasIdCardBack: false,
      age: Number(row.age || 0),
      balance: Number(row.balance || 0),
      isSued: row.is_sued === 1 || row.is_sued === true,
      guarantors: row.guarantors ? JSON.parse(row.guarantors) : [null, null, null],
      customerNumber: row.customer_number,
      balanceType: row.balance_type || 'debtor',
      dateOfBirth: formatDate(row.date_of_birth),
      nationalId: row.national_id || '',
      pensionDate: formatDate(row.pension_date),
      suedDate: row.sued_date || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    }));

    if (pagination) {
      const total = Number(countRow?.total || 0);
      return res.json({
        total,
        page: pagination.page,
        limit: pagination.limit,
        totalPages: Math.max(1, Math.ceil(total / pagination.limit)),
        stats: {
          totalCount: Number(statsRow?.totalCount || 0),
          debtorsCount: Number(statsRow?.debtorsCount || 0),
          suedCount: Number(statsRow?.suedCount || 0),
          totalReceivables: Number(statsRow?.totalReceivables || 0),
        },
        customers: mapped,
      });
    }

    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// GET /customers/:id
router.get('/:id', requireAnyPermission('sales:read', 'payments:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const row = await db.get<any>('SELECT * FROM customers WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ message: 'Customer not found' });
    return res.json({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      gender: row.gender,
      city: row.city,
      governorate: row.governorate,
      region: row.region,
      notes: row.notes,
      image: row.image || null,
      idCardFront: row.id_card_front || null,
      idCardBack: row.id_card_back || null,
      age: Number(row.age),
      balance: Number(row.balance),
      isSued: row.is_sued === 1 || row.is_sued === true,
      guarantors: row.guarantors ? JSON.parse(row.guarantors) : [null, null, null],
      customerNumber: row.customer_number,
      balanceType: row.balance_type,
      dateOfBirth: formatDate(row.date_of_birth),
      nationalId: row.national_id,
      pensionDate: formatDate(row.pension_date),
      suedDate: row.sued_date || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /customers
router.post('/', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Customer Validation Error:', JSON.stringify(parsed.error.format(), null, 2));
    return res.status(400).json({ message: 'Invalid customer payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const id = uid();
  const now = new Date().toISOString();
  const finalSuedDate = data.isSued ? (data.suedDate || now) : null;

  try {
    const db = await dbPromise;

    // Check for duplicate phone number
    const cleanPhone = data.phone?.trim();
    if (cleanPhone) {
      const existingPhone = (await db.get(
        'SELECT id, name, customer_number FROM customers WHERE phone = ?',
        cleanPhone
      )) as { id: string; name: string; customer_number: string } | undefined;
      if (existingPhone) {
        return res.status(409).json({
          message: `رقم الهاتف (${cleanPhone}) مسجل بالفعل للعميل "${existingPhone.name}" (كود: ${existingPhone.customer_number}). يرجى التأكد من عدم تكرار العميل.`
        });
      }
    }

    // Check for duplicate national ID
    const cleanNid = data.nationalId?.trim();
    if (cleanNid) {
      const existingNid = (await db.get(
        'SELECT id, name, customer_number FROM customers WHERE national_id = ?',
        cleanNid
      )) as { id: string; name: string; customer_number: string } | undefined;
      if (existingNid) {
        return res.status(409).json({
          message: `الرقم القومي (${cleanNid}) مسجل بالفعل للعميل "${existingNid.name}" (كود: ${existingNid.customer_number}).`
        });
      }
    }

    await db.run(
      `INSERT INTO customers (
        id, customer_number, name, phone, email, address, gender, city, governorate, region,
        date_of_birth, national_id, age, pension_date, balance, balance_type,
        notes, image, id_card_front, id_card_back, guarantors, is_sued, sued_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      data.idCardFront || null,
      data.idCardBack || null,
      data.guarantors ? JSON.stringify(data.guarantors) : null,
      data.isSued ? 1 : 0,
      finalSuedDate,
      now,
      now,
    );

    await audit('customer.create', 'customer', id, req.user?.name || 'system', data);
    broadcastDataChange('customers', 'create', id);
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
    const existing = await db.get<any>('SELECT id, sued_date FROM customers WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Check for duplicate phone number against other customers
    const cleanPhone = data.phone?.trim();
    if (cleanPhone) {
      const existingPhone = (await db.get(
        'SELECT id, name, customer_number FROM customers WHERE phone = ? AND id <> ?',
        cleanPhone,
        req.params.id
      )) as { id: string; name: string; customer_number: string } | undefined;
      if (existingPhone) {
        return res.status(409).json({
          message: `رقم الهاتف (${cleanPhone}) مسجل بالفعل لعميل آخر "${existingPhone.name}" (كود: ${existingPhone.customer_number}).`
        });
      }
    }

    // Check for duplicate national ID against other customers
    const cleanNid = data.nationalId?.trim();
    if (cleanNid) {
      const existingNid = (await db.get(
        'SELECT id, name, customer_number FROM customers WHERE national_id = ? AND id <> ?',
        cleanNid,
        req.params.id
      )) as { id: string; name: string; customer_number: string } | undefined;
      if (existingNid) {
        return res.status(409).json({
          message: `الرقم القومي (${cleanNid}) مسجل بالفعل لعميل آخر "${existingNid.name}" (كود: ${existingNid.customer_number}).`
        });
      }
    }

    const isValidExistingSuedDate = (date?: string | null) => {
      if (!date || date === '0' || date.includes('1970') || date.startsWith('0001')) return false;
      const d = new Date(date);
      return !isNaN(d.getTime()) && d.getFullYear() > 1970;
    };

    const finalSuedDate = data.isSued
      ? (isValidExistingSuedDate(data.suedDate) ? data.suedDate : (isValidExistingSuedDate(existing.sued_date) ? existing.sued_date : now))
      : null;

    // Preserve live financial balance managed atomically by sales & payments
    await db.run(
      `UPDATE customers
       SET customer_number = ?, name = ?, phone = ?, email = ?, address = ?, gender = ?,
           city = ?, governorate = ?, region = ?, date_of_birth = ?, national_id = ?, age = ?,
           pension_date = ?, balance_type = ?, notes = ?,
           image = ?, id_card_front = ?, id_card_back = ?, guarantors = ?, is_sued = ?, sued_date = ?, updated_at = ?
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
      data.balanceType,
      data.notes || null,
      data.image || null,
      data.idCardFront !== undefined ? (data.idCardFront || null) : (existing.id_card_front || null),
      data.idCardBack !== undefined ? (data.idCardBack || null) : (existing.id_card_back || null),
      data.guarantors ? JSON.stringify(data.guarantors) : null,
      data.isSued ? 1 : 0,
      finalSuedDate,
      now,
      req.params.id,
    );

    await audit('customer.update', 'customer', req.params.id, req.user?.name || 'system', data);
    broadcastDataChange('customers', 'update', req.params.id);
    return res.json({
      message: 'Customer updated successfully',
      customer: {
        id: req.params.id,
        isSued: data.isSued,
        suedDate: finalSuedDate,
        updatedAt: now,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PATCH /customers/:id/toggle-sued - Quick toggle for legal referral (isSued)
router.patch('/:id/toggle-sued', requirePermission('sales:write'), async (req: AuthedRequest, res) => {
  const toggleSchema = z.object({
    isSued: z.boolean(),
    suedDate: z.string().optional().nullable(),
  });

  const parsed = toggleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid payload', errors: parsed.error.format() });
  }

  const { isSued, suedDate } = parsed.data;
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get<any>('SELECT id, sued_date FROM customers WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const isValidDate = (date?: string | null) => {
      if (!date || date === '0' || date.includes('1970') || date.startsWith('0001')) return false;
      const d = new Date(date);
      return !isNaN(d.getTime()) && d.getFullYear() > 1970;
    };

    // When toggling off (إلغاء النزاع), clear sued_date = null.
    // When isSued is true, keep existing valid sued_date; if none, record new timestamp.
    const finalSuedDate = isSued
      ? (isValidDate(existing.sued_date) ? existing.sued_date : (isValidDate(suedDate) ? suedDate : now))
      : null;

    await db.run(
      `UPDATE customers
       SET is_sued = ?, sued_date = ?, updated_at = ?
       WHERE id = ?`,
      isSued ? 1 : 0,
      finalSuedDate,
      now,
      req.params.id
    );

    await audit('customer.toggle_sued', 'customer', req.params.id, req.user?.name || 'system', { isSued, suedDate: finalSuedDate });
    broadcastDataChange('customers', 'toggle_sued', req.params.id);

    return res.json({
      message: 'Legal referral status updated successfully',
      id: req.params.id,
      isSued,
      suedDate: finalSuedDate,
      updatedAt: now,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /customers/:id
router.delete('/:id', requirePermission('users:manage'), requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const customerRow = await db.get<{ id: string; name: string }>('SELECT id, name FROM customers WHERE id = ?', req.params.id);
    if (!customerRow) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    const activeSales = await db.get<{ count: number; total_debt: number }>(
      `SELECT COUNT(*) as count, COALESCE(SUM(remaining), 0) as total_debt
       FROM sales WHERE (customer_id = ? OR customer_name = ?) AND status != 'cancelled'`,
      req.params.id,
      customerRow.name
    );
    if (activeSales && activeSales.count > 0) {
      return res.status(400).json({
        message: `لا يمكن حذف هذا العميل لوجود ${activeSales.count} فاتورة/تعاقد ساري مسجل باسمه في النظام.`
      });
    }

    await db.run('DELETE FROM customers WHERE id = ?', req.params.id);
    await audit('customer.delete', 'customer', req.params.id, req.user?.name || 'system', { id: req.params.id });
    broadcastDataChange('customers', 'delete', req.params.id);
    return res.json({ message: 'Customer deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
