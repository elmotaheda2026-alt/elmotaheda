import { Router } from 'express';
import { formatDate, formatDateDisplay } from '../utils.js';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAdmin, requireAnyPermission, requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

const router = Router();
router.use(requireAuth);

const supplierSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  balance: z.number().default(0),
  notes: z.string().optional().nullable(),
});

// GET /suppliers
router.get('/', requireAnyPermission('sales:read', 'purchases:manage', 'payments:read'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM suppliers ORDER BY created_at DESC');
    const mapped = rows.map((row: any) => ({
      ...row,
      balance: Number(row.balance),
      createdAt: formatDate(row.created_at),
      updatedAt: row.updated_at,
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// GET /suppliers/:id/statement
router.get('/:id/statement', requireAnyPermission('sales:read', 'purchases:manage', 'payments:read'), async (req, res) => {
  try {
    const db = await dbPromise;
    const supplierId = req.params.id;

    // 1. Fetch supplier
    const supplier = await db.get<any>('SELECT * FROM suppliers WHERE id = ?', supplierId);
    if (!supplier) {
      return res.status(404).json({ message: 'المورد غير موجود' });
    }

    // 2. Fetch all purchases for this supplier
    const purchases = await db.all<any>(
      `SELECT id, invoice_number, subtotal, discount, tax, total, paid, remaining, status, date, notes, created_by, created_at
       FROM purchases
       WHERE supplier_id = ?
       ORDER BY date ASC, created_at ASC`,
      supplierId,
    );

    // Fetch items for purchases if any
    const purchaseIds = purchases.map((p: any) => p.id);
    const itemsByPurchaseId: Record<string, any[]> = {};
    if (purchaseIds.length > 0) {
      const placeholders = purchaseIds.map(() => '?').join(',');
      const allItems = await db.all<any>(
        `SELECT purchase_id, product_name, barcode, quantity, unit_price, discount, tax, total
         FROM purchase_items
         WHERE purchase_id IN (${placeholders})`,
        ...purchaseIds,
      );
      for (const item of allItems) {
        if (!itemsByPurchaseId[item.purchase_id]) {
          itemsByPurchaseId[item.purchase_id] = [];
        }
        itemsByPurchaseId[item.purchase_id].push({
          productName: item.product_name,
          barcode: item.barcode || '',
          quantity: Number(item.quantity),
          unitPrice: Number(item.unit_price),
          discount: Number(item.discount),
          tax: Number(item.tax),
          total: Number(item.total),
        });
      }
    }

    // 3. Fetch active non-voided payments linked to this supplier (excluding purchase downpayments already mirrored from purchases)
    const payments = await db.all<any>(
      `SELECT id, type, amount, description, date, receipt_number, status, channel, reference_id, reference_type, created_by, created_at
       FROM payments
       WHERE status = 'posted'
         AND COALESCE(reference_type, '') <> 'purchase_downpayment'
         AND (supplier_id = ? OR (reference_type = 'supplier' AND reference_id = ?))
       ORDER BY date ASC, created_at ASC`,
      supplierId,
      supplierId,
    );

    // 4. Calculate opening balance (allowing negative advance/credit balances)
    const currentBalance = Number(supplier.balance || 0);
    const sumPurchasesRemaining = purchases.reduce((acc: number, p: any) => acc + Number(p.remaining || 0), 0);
    const sumPaymentsOut = payments
      .filter((p: any) => p.type === 'out')
      .reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);
    const sumPaymentsIn = payments
      .filter((p: any) => p.type === 'in')
      .reduce((acc: number, p: any) => acc + Number(p.amount || 0), 0);

    const calculatedOpeningBalance = Number((currentBalance - sumPurchasesRemaining + sumPaymentsOut - sumPaymentsIn).toFixed(2));
    const openingBalance = calculatedOpeningBalance;

    // 5. Build raw events list
    type RawEvent = {
      date: string;
      createdAt: string;
      type: 'opening_balance' | 'purchase' | 'payment_out' | 'payment_in';
      data: any;
    };

    const rawEvents: RawEvent[] = [];

    if (Math.abs(openingBalance) > 0.01) {
      rawEvents.push({
        date: supplier.created_at || '2000-01-01',
        createdAt: supplier.created_at || '2000-01-01',
        type: 'opening_balance',
        data: {
          id: `op-${supplier.id}`,
          amount: openingBalance,
          notes: supplier.notes || (openingBalance < 0 ? 'رصيد دائن سابق لصالح الشركة عند المورد' : 'رصيد افتتاحي سابق للمورد'),
        },
      });
    }

    for (const p of purchases) {
      rawEvents.push({
        date: p.date,
        createdAt: p.created_at,
        type: 'purchase',
        data: p,
      });
    }

    for (const pay of payments) {
      rawEvents.push({
        date: pay.date,
        createdAt: pay.created_at,
        type: pay.type === 'in' ? 'payment_in' : 'payment_out',
        data: pay,
      });
    }

    // Sort chronologically by date, then by created_at, prioritizing opening balance first
    rawEvents.sort((a, b) => {
      if (a.type === 'opening_balance') return -1;
      if (b.type === 'opening_balance') return 1;
      const da = new Date(a.date).getTime() || 0;
      const dbDate = new Date(b.date).getTime() || 0;
      if (da !== dbDate) return da - dbDate;
      const ca = new Date(a.createdAt).getTime() || 0;
      const cb = new Date(b.createdAt).getTime() || 0;
      return ca - cb;
    });

    let running = 0;
    const transactions: any[] = [];

    for (const ev of rawEvents) {
      if (ev.type === 'opening_balance') {
        const amt = Number(ev.data.amount);
        running = Number((running + amt).toFixed(2));
        transactions.push({
          id: ev.data.id,
          date: formatDateDisplay(ev.date),
          rawDate: ev.date,
          type: 'opening_balance',
          typeLabel: 'الرصيد',
          docNumber: '—',
          description: ev.data.notes || 'الرصيد المسجل للمورد',
          credit: amt > 0 ? amt : 0,
          debit: amt < 0 ? Math.abs(amt) : 0,
          runningBalance: running,
        });
      } else if (ev.type === 'purchase') {
        const p = ev.data;
        const total = Number(p.total || 0);
        const paid = Number(p.paid || 0);

        if (paid > 0) {
          running += total;
          transactions.push({
            id: p.id,
            date: formatDateDisplay(p.date),
            rawDate: p.date,
            type: 'purchase',
            typeLabel: 'فاتورة مشتريات',
            docNumber: p.invoice_number,
            description: p.notes ? `فاتورة مشتريات - ${p.notes}` : 'فاتورة مشتريات بضاعة',
            credit: total,
            debit: 0,
            runningBalance: running,
            items: itemsByPurchaseId[p.id] || [],
            createdBy: p.created_by,
          });

          running -= paid;
          transactions.push({
            id: `downpayment-${p.id}`,
            date: formatDateDisplay(p.date),
            rawDate: p.date,
            type: 'purchase_downpayment',
            typeLabel: 'دفعة مسددة مع الفاتورة',
            docNumber: p.invoice_number,
            description: `سداد نقدي فوري مع الفاتورة رقم ${p.invoice_number}`,
            credit: 0,
            debit: paid,
            runningBalance: running,
          });
        } else {
          running += total;
          transactions.push({
            id: p.id,
            date: formatDateDisplay(p.date),
            rawDate: p.date,
            type: 'purchase',
            typeLabel: 'فاتورة مشتريات',
            docNumber: p.invoice_number,
            description: p.notes ? `فاتورة مشتريات - ${p.notes}` : 'فاتورة مشتريات بضاعة',
            credit: total,
            debit: 0,
            runningBalance: running,
            items: itemsByPurchaseId[p.id] || [],
            createdBy: p.created_by,
          });
        }
      } else if (ev.type === 'payment_out') {
        const pay = ev.data;
        const amt = Number(pay.amount || 0);
        running = Number((running - amt).toFixed(2));
        transactions.push({
          id: pay.id,
          date: formatDateDisplay(pay.date),
          rawDate: pay.date,
          type: 'payment_out',
          typeLabel: 'سداد دفعة للمورد',
          docNumber: pay.receipt_number || '—',
          description: pay.description || 'سند صرف نقدي للمورد',
          credit: 0,
          debit: amt,
          runningBalance: running,
          createdBy: pay.created_by,
        });
      } else if (ev.type === 'payment_in') {
        const pay = ev.data;
        const amt = Number(pay.amount || 0);
        running += amt;
        transactions.push({
          id: pay.id,
          date: formatDateDisplay(pay.date),
          rawDate: pay.date,
          type: 'payment_in',
          typeLabel: 'استرداد نقدي من المورد',
          docNumber: pay.receipt_number || '—',
          description: pay.description || 'سند قبض / استرداد من المورد',
          credit: amt,
          debit: 0,
          runningBalance: running,
          createdBy: pay.created_by,
        });
      }
    }

    const totalPurchasesAmount = purchases.reduce((acc: number, p: any) => acc + Number(p.total || 0), 0);
    const totalPaymentsAmount = sumPaymentsOut + purchases.reduce((acc: number, p: any) => acc + Number(p.paid || 0), 0);

    return res.json({
      supplier: {
        id: supplier.id,
        name: supplier.name,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
        balance: currentBalance,
        notes: supplier.notes,
        createdAt: formatDate(supplier.created_at),
        updatedAt: supplier.updated_at,
      },
      summary: {
        openingBalance,
        totalPurchasesAmount,
        totalPaymentsAmount,
        currentBalance,
        purchasesCount: purchases.length,
        paymentsCount: payments.length,
      },
      transactions,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /suppliers
router.post('/', requireAnyPermission('sales:write', 'purchases:manage'), async (req: AuthedRequest, res) => {
  const parsed = supplierSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid supplier payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const id = uid();
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    await db.run(
      `INSERT INTO suppliers (id, name, phone, email, address, balance, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.name,
      data.phone,
      data.email || null,
      data.address,
      data.balance,
      data.notes || null,
      now,
      now,
    );

    await audit('supplier.create', 'supplier', id, req.user?.name || 'system', data);
    return res.status(201).json({ id });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /suppliers/:id
router.put('/:id', requireAnyPermission('sales:write', 'purchases:manage'), async (req: AuthedRequest, res) => {
  const parsed = supplierSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid supplier payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get<{ id: string; balance: number }>(
      'SELECT id, balance FROM suppliers WHERE id = ?',
      req.params.id,
    );
    if (!existing) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    const ledgerLinks = await db.get<{ cnt: number }>(
      `SELECT (SELECT COUNT(*) FROM purchases WHERE supplier_id = ?) + (SELECT COUNT(*) FROM payments WHERE supplier_id = ? AND status = 'posted') AS cnt`,
      req.params.id,
      req.params.id,
    );
    const nextBalance = Number(ledgerLinks?.cnt || 0) > 0 ? Number(existing.balance || 0) : data.balance;

    await db.run(
      `UPDATE suppliers
       SET name = ?, phone = ?, email = ?, address = ?, balance = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      data.name,
      data.phone,
      data.email || null,
      data.address,
      nextBalance,
      data.notes || null,
      now,
      req.params.id,
    );

    await audit('supplier.update', 'supplier', req.params.id, req.user?.name || 'system', data);
    return res.json({ message: 'Supplier updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /suppliers/:id
router.delete('/:id', requireAnyPermission('users:manage', 'purchases:manage'), requireAdmin, async (req: AuthedRequest, res) => {
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get<{ id: string; name: string; balance: number }>('SELECT id, name, balance FROM suppliers WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    if (Number(existing.balance || 0) !== 0) {
      return res.status(400).json({ message: 'لا يمكن حذف المورد لأن لديه رصيد مستحق' });
    }

    let purchaseIds: string[] = [];
    await db.withTransaction(async (txDb) => {
      const purchases = (await txDb.all(
        'SELECT id, remaining FROM purchases WHERE supplier_id = ?',
        req.params.id,
      )) as { id: string; remaining: number }[];
      purchaseIds = purchases.map((purchase) => purchase.id);

      if (purchaseIds.length) {
        const purchaseItems = (await txDb.all(
          `SELECT product_id, quantity FROM purchase_items WHERE purchase_id IN (${purchaseIds.map(() => '?').join(',')})`,
          ...purchaseIds,
        )) as { product_id: string; quantity: number }[];

        for (const item of purchaseItems) {
          await txDb.run(
            `UPDATE products
             SET quantity = CASE WHEN quantity - ? < 0 THEN 0 ELSE quantity - ? END,
                 updated_at = ?
             WHERE id = ?`,
            item.quantity,
            item.quantity,
            now,
            item.product_id,
          );
        }

        await txDb.run(
          `DELETE FROM payments
           WHERE supplier_id = ?
              OR (reference_type = 'supplier' AND reference_id = ?)
              OR (reference_type = 'purchase' AND reference_id IN (${purchaseIds.map(() => '?').join(',')}))`,
          req.params.id,
          req.params.id,
          ...purchaseIds,
        );
        await txDb.run(
          `DELETE FROM purchase_items WHERE purchase_id IN (${purchaseIds.map(() => '?').join(',')})`,
          ...purchaseIds,
        );
        await txDb.run(
          `DELETE FROM purchases WHERE id IN (${purchaseIds.map(() => '?').join(',')})`,
          ...purchaseIds,
        );
      } else {
        await txDb.run(
          `DELETE FROM payments
           WHERE supplier_id = ?
              OR (reference_type = 'supplier' AND reference_id = ?)`,
          req.params.id,
          req.params.id,
        );
      }

      await txDb.run('DELETE FROM suppliers WHERE id = ?', req.params.id);
    });
    await audit('supplier.delete', 'supplier', req.params.id, req.user?.name || 'system', {
      id: req.params.id,
      name: existing.name,
      deletedPurchaseIds: purchaseIds,
    });
    return res.json({ message: 'Supplier deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
