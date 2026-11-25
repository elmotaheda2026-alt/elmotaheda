import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAdmin, requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid, formatDate, parseDateInput, isPeriodClosed } from '../utils.js';

const router = Router();
router.use(requireAuth);

const purchaseItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  barcode: z.string().optional().nullable(),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  total: z.number().nonnegative(),
});

const purchaseSchema = z.object({
  invoiceNumber: z.string().min(1),
  supplierId: z.string().min(1),
  supplierName: z.string().min(1),
  items: z.array(purchaseItemSchema).min(1),
  subtotal: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  total: z.number().positive(),
  paid: z.number().nonnegative().default(0),
  date: z.string().min(8),
  notes: z.string().optional().nullable(),
});

type PurchaseInput = z.infer<typeof purchaseSchema>;

const roundMoney = (value: number) => Number(Number(value || 0).toFixed(2));

function validatePurchaseTotals(data: PurchaseInput): string | null {
  const subtotal = roundMoney(data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const itemsDiscount = roundMoney(data.items.reduce((sum, item) => sum + item.quantity * item.discount, 0));
  const discount = roundMoney(data.discount || itemsDiscount);
  const tax = roundMoney(data.items.reduce((sum, item) => sum + item.quantity * item.tax, 0));
  const total = roundMoney(subtotal - discount + tax);
  const itemsMismatch = data.items.some(
    (item) => roundMoney(item.total) !== roundMoney(item.quantity * item.unitPrice - item.quantity * item.discount + item.quantity * item.tax),
  );

  if (itemsMismatch) return 'Purchase item totals do not match quantity, unit price, discount, and tax.';
  if (roundMoney(data.subtotal) !== subtotal) return 'Purchase subtotal does not match item subtotal.';
  if (roundMoney(data.tax) !== tax) return 'Purchase tax does not match item taxes.';
  if (roundMoney(data.total) !== total) return 'Purchase total does not match subtotal - discount + tax.';
  if (roundMoney(data.paid) > total) return 'Paid amount cannot exceed purchase total.';
  return null;
}

// GET /purchases
router.get('/', requirePermission('purchases:manage'), async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM purchases ORDER BY created_at DESC');
    const mapped = rows.map((row: any) => ({
      id: row.id,
      invoiceNumber: row.invoice_number,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      subtotal: Number(row.subtotal),
      discount: Number(row.discount),
      tax: Number(row.tax),
      total: Number(row.total),
      paid: Number(row.paid),
      remaining: Number(row.remaining),
      status: row.status,
      date: formatDate(row.date),
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: formatDate(row.created_at),
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// GET /purchases/:id
router.get('/:id', requirePermission('purchases:manage'), async (req, res) => {
  try {
    const db = await dbPromise;
    const purchase = await db.get<any>('SELECT * FROM purchases WHERE id = ?', req.params.id);
    if (!purchase) {
      return res.status(404).json({ message: 'Purchase invoice not found' });
    }

    const items = await db.all('SELECT * FROM purchase_items WHERE purchase_id = ?', req.params.id);
    const mappedItems = items.map((item: any) => ({
      productId: item.product_id,
      productName: item.product_name,
      barcode: item.barcode || '',
      quantity: Number(item.quantity),
      unitPrice: Number(item.unit_price),
      discount: Number(item.discount),
      tax: Number(item.tax),
      total: Number(item.total),
    }));

    return res.json({
      id: purchase.id,
      invoiceNumber: purchase.invoice_number,
      supplierId: purchase.supplier_id,
      supplierName: purchase.supplier_name,
      subtotal: Number(purchase.subtotal),
      discount: Number(purchase.discount),
      tax: Number(purchase.tax),
      total: Number(purchase.total),
      paid: Number(purchase.paid),
      remaining: Number(purchase.remaining),
      status: purchase.status,
      date: formatDate(purchase.date),
      notes: purchase.notes,
      createdBy: purchase.created_by,
      createdAt: formatDate(purchase.created_at),
      items: mappedItems,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /purchases
router.post('/', requirePermission('purchases:manage'), async (req: AuthedRequest, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid purchase payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const totalsError = validatePurchaseTotals(data);
  if (totalsError) {
    return res.status(400).json({ message: totalsError });
  }
  // Parse date input (DD/MM/YYYY) to ISO
  try {
    data.date = parseDateInput(data.date);
  } catch (e) {
    return res.status(400).json({ message: e instanceof Error ? e.message : 'Invalid date format' });
  }
  const id = uid();
  const now = new Date().toISOString();
  const remaining = Number((data.total - data.paid).toFixed(2));
  const status = remaining <= 0 ? 'completed' : 'pending';

  try {
    const db = await dbPromise;
    if (req.user?.role !== 'admin' && await isPeriodClosed(db, data.date)) {
      return res.status(403).json({ message: 'الفترة المالية مغلقة ولا يمكن تسجيل فواتير شراء فيها إلا بواسطة المدير.' });
    }

    await db.withTransaction(async (txDb) => {
      // Verify supplier exists
      const supplier = await txDb.get('SELECT id FROM suppliers WHERE id = ?', data.supplierId);
      if (!supplier) {
        throw new Error('المورد المحدد غير موجود في النظام');
      }

      // Insert purchase invoice
      await txDb.run(
        `INSERT INTO purchases (
          id, invoice_number, supplier_id, supplier_name, subtotal, discount, tax,
          total, paid, remaining, status, date, notes, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.invoiceNumber,
        data.supplierId,
        data.supplierName,
        data.subtotal,
        data.discount,
        data.tax,
        data.total,
        data.paid,
        remaining,
        status,
        data.date,
        data.notes || null,
        req.user?.name || 'system',
        now,
      );

      // Insert purchase items
      for (const item of data.items) {
        const itemId = uid();
        // Insert purchase item
        await txDb.run(
          `INSERT INTO purchase_items (
            id, purchase_id, product_id, product_name, barcode, quantity, unit_price, discount, tax, total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          itemId,
          id,
          item.productId,
          item.productName,
          item.barcode || null,
          item.quantity,
          item.unitPrice,
          item.discount,
          item.tax,
          item.total,
        );

        // Increase product inventory in SQL Server (only for stocked warehouse products) and update weighted-average purchase price
        await txDb.run(
          `UPDATE products
           SET purchase_price = CASE
                 WHEN ? > 0 AND fulfillment_type = 'stocked' AND quantity > 0 AND purchase_price > 0
                   THEN ROUND(((quantity * purchase_price) + (? * ?)) / (quantity + ?), 2)
                 WHEN ? > 0 THEN ?
                 ELSE purchase_price
               END,
               quantity = CASE WHEN fulfillment_type = 'stocked' THEN quantity + ? ELSE quantity END,
               updated_at = ?
           WHERE id = ?`,
          item.unitPrice,
          item.quantity,
          item.unitPrice,
          item.quantity,
          item.unitPrice,
          item.unitPrice,
          item.quantity,
          now,
          item.productId,
        );
      }

      // Update supplier balance (add the remaining unpaid amount to their creditor balance)
      await txDb.run(
        `UPDATE suppliers
         SET balance = balance + ?,
             updated_at = ?
         WHERE id = ?`,
        remaining,
        now,
        data.supplierId,
      );

      // Record cash outflow in treasury when upfront cash is paid on the purchase invoice
      if (Number(data.paid || 0) > 0) {
        await txDb.run(
          `INSERT INTO payments (
            id, type, amount, description, date, receipt_number, status, channel,
            reference_id, reference_type, supplier_id, invoice_number, affects_customer_balance,
            created_by, created_at
          ) VALUES (?, 'out', ?, ?, ?, ?, 'posted', 'cash', ?, 'purchase_downpayment', ?, ?, 0, ?, ?)`,
          uid(),
          Number(data.paid),
          `سداد نقدي مع فاتورة شراء رقم ${data.invoiceNumber} - ${data.supplierName}`,
          data.date,
          `PUR-${id.slice(-6).toUpperCase()}`,
          id,
          data.supplierId,
          data.invoiceNumber,
          req.user?.name || 'system',
          now,
        );
      }
    });

    await audit('purchase.create', 'purchase', id, req.user?.name || 'system', {
      id,
      invoiceNumber: data.invoiceNumber,
      total: data.total,
      paid: data.paid,
      remaining,
    });

    return res.status(201).json({ id });
  } catch (error: any) {
    if (error.message === 'المورد المحدد غير موجود في النظام') {
      return res.status(400).json({ message: error.message });
    }
    if (error.message?.includes('UNIQUE') || error.message?.includes('violates UNIQUE constraint')) {
      return res.status(409).json({ message: 'رقم فاتورة الشراء مسجل بالفعل' });
    }
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /purchases/:id — Cancel/return purchase invoice cleanly
router.delete('/:id', requirePermission('purchases:manage'), requireAdmin, async (req: AuthedRequest, res) => {
  const now = new Date().toISOString();
  try {
    const db = await dbPromise;
    const purchase = await db.get<any>('SELECT * FROM purchases WHERE id = ?', req.params.id);
    if (!purchase) {
      return res.status(404).json({ message: 'فاتورة الشراء غير موجودة' });
    }
    if (req.user?.role !== 'admin' && await isPeriodClosed(db, String(purchase.date || '').slice(0, 10))) {
      return res.status(403).json({ message: 'الفترة المالية مغلقة ولا يمكن إلغاء الفاتورة.' });
    }

    await db.withTransaction(async (txDb) => {
      const items = (await txDb.all(
        'SELECT product_id, quantity FROM purchase_items WHERE purchase_id = ?',
        req.params.id,
      )) as Array<{ product_id: string; quantity: number }>;

      for (const item of items) {
        await txDb.run(
          `UPDATE products
           SET quantity = CASE WHEN fulfillment_type = 'stocked' THEN CASE WHEN quantity - ? < 0 THEN 0 ELSE quantity - ? END ELSE quantity END,
               updated_at = ?
           WHERE id = ?`,
          item.quantity,
          item.quantity,
          now,
          item.product_id,
        );
      }

      if (Number(purchase.remaining || 0) !== 0) {
        await txDb.run(
          'UPDATE suppliers SET balance = balance - ?, updated_at = ? WHERE id = ?',
          Number(purchase.remaining || 0),
          now,
          purchase.supplier_id,
        );
      }

      await txDb.run(
        `UPDATE payments SET status = 'voided', approved_by = ? WHERE reference_type = 'purchase_downpayment' AND reference_id = ?`,
        req.user?.name || 'system',
        req.params.id,
      );

      await txDb.run('DELETE FROM purchase_items WHERE purchase_id = ?', req.params.id);
      await txDb.run('DELETE FROM purchases WHERE id = ?', req.params.id);
    });

    await audit('purchase.delete', 'purchase', req.params.id, req.user?.name || 'system', {
      invoiceNumber: purchase.invoice_number,
      supplierId: purchase.supplier_id,
      total: purchase.total,
    });
    return res.json({ message: 'تم إلغاء فاتورة الشراء ورد كمياتها للمخزون وتعديل حساب المورد بنجاح.' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
