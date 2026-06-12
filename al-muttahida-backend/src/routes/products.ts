import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { uid } from '../utils.js';

const router = Router();
router.use(requireAuth);

const productSchema = z.object({
  name: z.string().min(1),
  barcode: z.string().min(1),
  category: z.string().min(1),
  fulfillmentType: z.enum(['stocked', 'on_demand']).default('stocked'),
  unit: z.string().min(1),
  purchasePrice: z.number().nonnegative(),
  salePrice: z.number().nonnegative(),
  discount: z.number().nonnegative().default(0),
  tax: z.number().nonnegative().default(0),
  quantity: z.number().nonnegative().default(0),
  minQuantity: z.number().nonnegative().default(0),
  image: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

// GET /products
router.get('/', async (_req, res) => {
  try {
    const db = await dbPromise;
    const rows = await db.all('SELECT * FROM products ORDER BY created_at DESC');
    const mapped = rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      barcode: row.barcode,
      category: row.category,
      fulfillmentType: row.fulfillment_type,
      unit: row.unit,
      purchasePrice: Number(row.purchase_price),
      salePrice: Number(row.sale_price),
      discount: Number(row.discount),
      tax: Number(row.tax),
      quantity: Number(row.quantity),
      minQuantity: Number(row.min_quantity),
      image: row.image,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    return res.json(mapped);
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /products
router.post('/', requirePermission('inventory:manage'), async (req: AuthedRequest, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid product payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const id = uid();
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    await db.run(
      `INSERT INTO products (
        id, name, barcode, category, fulfillment_type, unit, purchase_price,
        sale_price, discount, tax, quantity, min_quantity, image, description,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      data.name,
      data.barcode,
      data.category,
      data.fulfillmentType,
      data.unit,
      data.purchasePrice,
      data.salePrice,
      data.discount,
      data.tax,
      data.quantity,
      data.minQuantity,
      data.image || null,
      data.description || null,
      now,
      now,
    );

    await audit('product.create', 'product', id, req.user?.name || 'system', data);
    return res.status(201).json({ id });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE') || error.message?.includes('violates UNIQUE constraint')) {
      return res.status(409).json({ message: 'الباركود مسجل بالفعل لمنتج آخر' });
    }
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /products/:id
router.put('/:id', requirePermission('inventory:manage'), async (req: AuthedRequest, res) => {
  const parsed = productSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid product payload', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const now = new Date().toISOString();

  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM products WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await db.run(
      `UPDATE products
       SET name = ?, barcode = ?, category = ?, fulfillment_type = ?, unit = ?,
           purchase_price = ?, sale_price = ?, discount = ?, tax = ?,
           quantity = ?, min_quantity = ?, image = ?, description = ?, updated_at = ?
       WHERE id = ?`,
      data.name,
      data.barcode,
      data.category,
      data.fulfillmentType,
      data.unit,
      data.purchasePrice,
      data.salePrice,
      data.discount,
      data.tax,
      data.quantity,
      data.minQuantity,
      data.image || null,
      data.description || null,
      now,
      req.params.id,
    );

    await audit('product.update', 'product', req.params.id, req.user?.name || 'system', data);
    return res.json({ message: 'Product updated successfully' });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE') || error.message?.includes('violates UNIQUE constraint')) {
      return res.status(409).json({ message: 'الباركود مسجل بالفعل لمنتج آخر' });
    }
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /products/:id
router.delete('/:id', requirePermission('inventory:manage'), async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT id FROM products WHERE id = ?', req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await db.run('DELETE FROM products WHERE id = ?', req.params.id);
    await audit('product.delete', 'product', req.params.id, req.user?.name || 'system', { id: req.params.id });
    return res.json({ message: 'Product deleted successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
