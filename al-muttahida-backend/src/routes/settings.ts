import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';

const router = Router();
router.use(requireAuth);

const settingsSchema = z.object({
  companyName: z.string().min(1),
  companyAddress: z.string().min(1),
  companyPhone: z.string().min(1),
  companyEmail: z.string().email(),
  taxRate: z.number().nonnegative(),
  currency: z.string().min(1),
  invoicePrefix: z.string().min(1),
  invoiceFooter: z.string().optional().nullable(),
});

// GET /settings
router.get('/', async (_req, res) => {
  try {
    const db = await dbPromise;
    let settings = await db.get<any>('SELECT TOP 1 * FROM settings');
    
    // Seed default settings if not exists
    if (!settings) {
      await db.run(
        `INSERT INTO settings (company_name, company_address, company_phone, company_email, tax_rate, currency, invoice_prefix, invoice_footer)
         VALUES (?, ?, ?, ?, 0, ?, ?, ? )`,
        'شركة المتحدة',
        'الشارع المقابل للبوابة الخلفية للمستشفى العام',
        '01001207474',
        'info@almuttahida.com',
        'جنيه',
        'INV',
        'شكراً للتعامل معنا - شركة المتحدة',
      );
      settings = await db.get<any>('SELECT TOP 1 * FROM settings');
    } else if (Number(settings.tax_rate) === 14) {
      await db.run('UPDATE settings SET tax_rate = 0');
      settings.tax_rate = 0;
    }

    return res.json({
      companyName: settings.company_name,
      companyAddress: settings.company_address,
      companyPhone: settings.company_phone,
      companyEmail: settings.company_email,
      taxRate: Number(settings.tax_rate),
      currency: settings.currency,
      invoicePrefix: settings.invoice_prefix,
      invoiceFooter: settings.invoice_footer,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /settings
router.put('/', requirePermission('settings:manage'), async (req: AuthedRequest, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid settings payload', errors: parsed.error.format() });
  }

  const data = parsed.data;

  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT TOP 1 company_name FROM settings');
    if (!existing) {
      await db.run(
        `INSERT INTO settings (company_name, company_address, company_phone, company_email, tax_rate, currency, invoice_prefix, invoice_footer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        data.companyName,
        data.companyAddress,
        data.companyPhone,
        data.companyEmail,
        data.taxRate,
        data.currency,
        data.invoicePrefix,
        data.invoiceFooter || null,
      );
    } else {
      await db.run(
        `UPDATE settings
         SET company_name = ?, company_address = ?, company_phone = ?, company_email = ?,
             tax_rate = ?, currency = ?, invoice_prefix = ?, invoice_footer = ?`,
        data.companyName,
        data.companyAddress,
        data.companyPhone,
        data.companyEmail,
        data.taxRate,
        data.currency,
        data.invoicePrefix,
        data.invoiceFooter || null,
      );
    }

    await audit('settings.update', 'settings', 'global', req.user?.name || 'system', data);
    return res.json({ message: 'Settings updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /settings/clear-data
router.post('/clear-data', requirePermission('settings:manage'), async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    
    await db.run('DELETE FROM sale_items');
    await db.run('DELETE FROM sales');
    
    await db.run('DELETE FROM purchase_items');
    await db.run('DELETE FROM purchases');
    
    await db.run('DELETE FROM installment_schedules');
    await db.run('DELETE FROM payments');
    await db.run('DELETE FROM expenses');
    await db.run('DELETE FROM notifications');
    await db.run('DELETE FROM sales_reps');
    await db.run('DELETE FROM shareholders');
    await db.run('DELETE FROM shareholder_transactions');
    await db.run('DELETE FROM collection_tasks');
    await db.run('DELETE FROM audit_log');
    await db.run('DELETE FROM closing_periods');
    await db.run('DELETE FROM reschedule_requests');
    await db.run('DELETE FROM customers');
    await db.run('DELETE FROM suppliers');
    await db.run('DELETE FROM products');
    
    await audit('database.clear', 'database', 'global', req.user?.name || 'system', {});
    return res.json({ message: 'تم حذف جميع البيانات بنجاح' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;
