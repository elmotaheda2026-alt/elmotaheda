import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

const router = Router();
router.use(requireAuth);

const purchaseItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  barcode: z.string().min(1),
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
      date: row.date,
      notes: row.notes,
      createdBy: row.created_by,
      createdAt: row.created_at,
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
      barcode: item.barcode,
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
      date: purchase.date,
      notes: purchase.notes,
      createdBy: purchase.created_by,
      createdAt: purchase.created_at,
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
  const id = uid();
  const now = new Date().toISOString();
  const remaining = Number((data.total - data.paid).toFixed(2));
  const status = remaining <= 0 ? 'completed' : 'pending';

  try {
    const db = await dbPromise;

    // Verify supplier exists
    const supplier = await db.get('SELECT id FROM suppliers WHERE id = ?', data.supplierId);
    if (!supplier) {
      return res.status(400).json({ message: 'المورد المحدد غير موجود في النظام' });
    }

    // Insert purchase invoice
    await db.run(
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

    // Insert purchase items and update product stock
    for (const item of data.items) {
      const itemId = uid();
      await db.run(
        `INSERT INTO purchase_items (
          id, purchase_id, product_id, product_name, barcode, quantity, unit_price, discount, tax, total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        itemId,
        id,
        item.productId,
        item.productName,
        item.barcode,
        item.quantity,
        item.unitPrice,
        item.discount,
        item.tax,
        item.total,
      );

      // Increase product quantity in stock
      await db.run(
        `UPDATE products
         SET quantity = quantity + ?,
             updated_at = ?
         WHERE id = ?`,
        item.quantity,
        now,
        item.productId,
      );
    }

    // Update supplier balance (add the remaining unpaid amount to their creditor balance)
    // In our system, supplier balance represents what we owe them.
    // If we purchase goods and haven't fully paid, our remaining balance to them increases.
    await db.run(
      `UPDATE suppliers
       SET balance = balance + ?,
           updated_at = ?
       WHERE id = ?`,
      remaining,
      now,
      data.supplierId,
    );

    await audit('purchase.create', 'purchase', id, req.user?.name || 'system', {
      id,
      invoiceNumber: data.invoiceNumber,
      total: data.total,
      remaining,
    });

    return res.status(201).json({ id });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE') || error.message?.includes('violates UNIQUE constraint')) {
      return res.status(409).json({ message: 'رقم فاتورة الشراء مسجل بالفعل' });
    }
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
