import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAdmin, requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';
import { getRolePermissions, setRolePermissions, validPermissions } from '../permissions.js';
import { broadcastDataChange } from '../realtime.js';
import type { Permission, UserRole } from '../types.js';

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
  whatsappRemindersEnabled: z.boolean().optional(),
  whatsappMode: z.enum(['web_session', 'meta_api']).optional(),
  whatsappPhoneNumberId: z.string().optional().nullable(),
  whatsappAccessToken: z.string().optional().nullable(),
  whatsappTemplateName: z.string().optional().nullable(),
  whatsappTemplateLanguage: z.string().optional().nullable(),
  whatsappMessageTemplate: z.string().optional().nullable(),
  whatsappReminderOffsets: z.array(z.number()).optional(),
  whatsappMinDelaySec: z.number().nonnegative().optional(),
  whatsappMaxDelaySec: z.number().nonnegative().optional(),
  whatsappDailyLimit: z.number().positive().optional(),
  whatsappBatchSize: z.number().positive().optional(),
  whatsappBatchPauseSec: z.number().nonnegative().optional(),
  whatsappSendStartHour: z.string().optional().nullable(),
  whatsappSendEndHour: z.string().optional().nullable(),
  whatsappAntiBanVariation: z.boolean().optional(),
  whatsappAutoSkipInvalid: z.boolean().optional(),
});

async function ensureWhatsappConfigColumn(db: any) {
  await db.run(`
    IF COL_LENGTH('settings', 'whatsapp_config_json') IS NULL
    BEGIN
      ALTER TABLE settings ADD whatsapp_config_json NVARCHAR(MAX) NULL;
    END
    IF COL_LENGTH('settings', 'role_permissions_json') IS NULL
    BEGIN
      ALTER TABLE settings ADD role_permissions_json NVARCHAR(MAX) NULL;
    END
  `);
}

function parseRolePermissionsJson(raw?: string | null): Partial<Record<UserRole, Permission[]>> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function parseWhatsappConfig(raw?: string | null) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const openingBalancesSchema = z.object({
  startingCashBalance: z.number().nonnegative(),
  startingReceivables: z.number().nonnegative(),
  startingPayables: z.number().nonnegative(),
  startingInventoryValue: z.number().nonnegative(),
});

// GET /settings
router.get('/', async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    await ensureWhatsappConfigColumn(db);
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
        'شكراً للتعامل معنا - شركة المتحدة'
      );
      settings = await db.get<any>('SELECT TOP 1 * FROM settings');
    } else if (Number(settings.tax_rate) === 14) {
      await db.run('UPDATE settings SET tax_rate = 0');
      settings.tax_rate = 0;
    }

    const waConfig = parseWhatsappConfig(settings.whatsapp_config_json);
    const savedRolePerms = parseRolePermissionsJson(settings.role_permissions_json);
    const effectiveRolePermissions = savedRolePerms ? setRolePermissions(savedRolePerms) : getRolePermissions();
    const canManageSettings =
      req.user?.role === 'admin' ||
      (Array.isArray(req.user?.permissions) && req.user.permissions.includes('settings:manage'));

    return res.json({
      companyName: settings.company_name,
      companyAddress: settings.company_address,
      companyPhone: settings.company_phone,
      companyEmail: settings.company_email,
      taxRate: Number(settings.tax_rate),
      currency: settings.currency,
      invoicePrefix: settings.invoice_prefix,
      baselineCapital: Number(settings.baseline_capital || 8500000),
      invoiceFooter: settings.invoice_footer,
      whatsappRemindersEnabled: Boolean(waConfig.whatsappRemindersEnabled),
      whatsappMode: waConfig.whatsappMode === 'meta_api' ? 'meta_api' : 'web_session',
      whatsappPhoneNumberId: canManageSettings ? (waConfig.whatsappPhoneNumberId || '') : '',
      whatsappAccessToken: canManageSettings ? (waConfig.whatsappAccessToken || '') : '',
      whatsappTemplateName: waConfig.whatsappTemplateName || 'installment_reminder',
      whatsappTemplateLanguage: waConfig.whatsappTemplateLanguage || 'ar',
      whatsappMessageTemplate: waConfig.whatsappMessageTemplate || '',
      whatsappReminderOffsets: Array.isArray(waConfig.whatsappReminderOffsets) ? waConfig.whatsappReminderOffsets : [-2, -1, 0],
      whatsappMinDelaySec: Number.isFinite(waConfig.whatsappMinDelaySec) ? waConfig.whatsappMinDelaySec : 15,
      whatsappMaxDelaySec: Number.isFinite(waConfig.whatsappMaxDelaySec) ? waConfig.whatsappMaxDelaySec : 45,
      whatsappDailyLimit: Number.isFinite(waConfig.whatsappDailyLimit) ? waConfig.whatsappDailyLimit : 80,
      whatsappBatchSize: Number.isFinite(waConfig.whatsappBatchSize) ? waConfig.whatsappBatchSize : 15,
      whatsappBatchPauseSec: Number.isFinite(waConfig.whatsappBatchPauseSec) ? waConfig.whatsappBatchPauseSec : 180,
      whatsappSendStartHour: waConfig.whatsappSendStartHour || '10:00',
      whatsappSendEndHour: waConfig.whatsappSendEndHour || '21:00',
      whatsappAntiBanVariation: waConfig.whatsappAntiBanVariation !== false,
      whatsappAutoSkipInvalid: waConfig.whatsappAutoSkipInvalid !== false,
      rolePermissions: effectiveRolePermissions,
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
  const whatsappConfigJson = JSON.stringify({
    whatsappRemindersEnabled: Boolean(data.whatsappRemindersEnabled),
    whatsappMode: data.whatsappMode === 'meta_api' ? 'meta_api' : 'web_session',
    whatsappPhoneNumberId: data.whatsappPhoneNumberId || '',
    whatsappAccessToken: data.whatsappAccessToken || '',
    whatsappTemplateName: data.whatsappTemplateName || 'installment_reminder',
    whatsappTemplateLanguage: data.whatsappTemplateLanguage || 'ar',
    whatsappMessageTemplate: data.whatsappMessageTemplate || '',
    whatsappReminderOffsets: Array.isArray(data.whatsappReminderOffsets) ? data.whatsappReminderOffsets : [-2, -1, 0],
    whatsappMinDelaySec: Number.isFinite(data.whatsappMinDelaySec) ? data.whatsappMinDelaySec : 15,
    whatsappMaxDelaySec: Number.isFinite(data.whatsappMaxDelaySec) ? data.whatsappMaxDelaySec : 45,
    whatsappDailyLimit: Number.isFinite(data.whatsappDailyLimit) ? data.whatsappDailyLimit : 80,
    whatsappBatchSize: Number.isFinite(data.whatsappBatchSize) ? data.whatsappBatchSize : 15,
    whatsappBatchPauseSec: Number.isFinite(data.whatsappBatchPauseSec) ? data.whatsappBatchPauseSec : 180,
    whatsappSendStartHour: data.whatsappSendStartHour || '10:00',
    whatsappSendEndHour: data.whatsappSendEndHour || '21:00',
    whatsappAntiBanVariation: data.whatsappAntiBanVariation !== false,
    whatsappAutoSkipInvalid: data.whatsappAutoSkipInvalid !== false,
  });

  try {
    const db = await dbPromise;
    await ensureWhatsappConfigColumn(db);
    const existing = await db.get('SELECT TOP 1 company_name FROM settings');
    if (!existing) {
      await db.run(
        `INSERT INTO settings (company_name, company_address, company_phone, company_email, tax_rate, currency, invoice_prefix, invoice_footer, whatsapp_config_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        data.companyName,
        data.companyAddress,
        data.companyPhone,
        data.companyEmail,
        data.taxRate,
        data.currency,
        data.invoicePrefix,
        data.invoiceFooter || null,
        whatsappConfigJson
      );
    } else {
      await db.run(
        `UPDATE settings
         SET company_name = ?, company_address = ?, company_phone = ?, company_email = ?,
             tax_rate = ?, currency = ?, invoice_prefix = ?, invoice_footer = ?, whatsapp_config_json = ?`,
        data.companyName,
        data.companyAddress,
        data.companyPhone,
        data.companyEmail,
        data.taxRate,
        data.currency,
        data.invoicePrefix,
        data.invoiceFooter || null,
        whatsappConfigJson
      );
    }

    await audit('settings.update', 'settings', 'global', req.user?.name || 'system', data);
    return res.json({ message: 'Settings updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// GET /settings/opening-balances
router.get('/opening-balances', async (_req, res) => {
  try {
    const db = await dbPromise;
    const settings = await db.get<any>('SELECT TOP 1 starting_cash_balance, starting_receivables, starting_payables, starting_inventory_value FROM settings');
    return res.json({
      startingCashBalance: Number(settings?.starting_cash_balance || 0),
      startingReceivables: Number(settings?.starting_receivables || 0),
      startingPayables: Number(settings?.starting_payables || 0),
      startingInventoryValue: Number(settings?.starting_inventory_value || 0),
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /settings/opening-balances
router.put('/opening-balances', requirePermission('settings:manage'), async (req: AuthedRequest, res) => {
  const parsed = openingBalancesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid opening balances payload', errors: parsed.error.format() });
  }

  const { startingCashBalance, startingReceivables, startingPayables, startingInventoryValue } = parsed.data;

  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT TOP 1 company_name FROM settings');
    if (!existing) {
      await db.run(
        `INSERT INTO settings (company_name, company_address, company_phone, company_email, tax_rate, currency, invoice_prefix, starting_cash_balance, starting_receivables, starting_payables, starting_inventory_value)
         VALUES ('شركة المتحدة', '', '01001207474', 'info@almuttahida.com', 0, 'جنيه', 'INV', ?, ?, ?, ?)`,
        startingCashBalance,
        startingReceivables,
        startingPayables,
        startingInventoryValue
      );
    } else {
      await db.run(
        `UPDATE settings
         SET starting_cash_balance = ?, starting_receivables = ?, starting_payables = ?, starting_inventory_value = ?`,
        startingCashBalance,
        startingReceivables,
        startingPayables,
        startingInventoryValue
      );
    }

    await audit('opening_balances.update', 'settings', 'global', req.user?.name || 'system', parsed.data);
    return res.json({ message: 'Opening balances updated successfully' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /settings/clear-data
router.post('/clear-data', requirePermission('settings:manage'), requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const db = await dbPromise;
    
    // Delete child tables before parent tables atomically inside a transaction
    await db.withTransaction(async (txDb) => {
      await txDb.run('DELETE FROM sale_items');
      await txDb.run('DELETE FROM installment_schedules');
      await txDb.run('DELETE FROM reschedule_requests');
      await txDb.run('DELETE FROM payments');
      await txDb.run('DELETE FROM payments_archive');
      await txDb.run('DELETE FROM collection_tasks');
      await txDb.run('DELETE FROM collection_tasks_archive');
      await txDb.run('DELETE FROM sales');

      await txDb.run('DELETE FROM purchase_items');
      await txDb.run('DELETE FROM purchases');

      await txDb.run('DELETE FROM shareholder_transactions');
      await txDb.run('DELETE FROM shareholders');
      await txDb.run('DELETE FROM expenses');
      await txDb.run('DELETE FROM notifications');
      await txDb.run('DELETE FROM sales_reps');
      await txDb.run('DELETE FROM audit_log');
      await txDb.run('DELETE FROM closing_periods');
      await txDb.run('DELETE FROM dashboard_metrics_cache');
      await txDb.run('DELETE FROM customers');
      await txDb.run('DELETE FROM suppliers');
      await txDb.run('DELETE FROM products');
    });
    
    await audit('database.clear', 'database', 'global', req.user?.name || 'system', {});
    return res.json({ message: 'تم حذف جميع البيانات بنجاح' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

const rolePermissionsUpdateSchema = z.object({
  rolePermissions: z.record(
    z.enum(['admin', 'manager', 'accountant', 'user', 'collector', 'reviewer', 'finance_manager']),
    z.array(z.string())
  ),
});

// PUT /settings/role-permissions (Admin only)
router.put('/role-permissions', requireAdmin, async (req: AuthedRequest, res) => {
  const parsed = rolePermissionsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid role permissions payload', errors: parsed.error.format() });
  }

  try {
    const db = await dbPromise;
    await ensureWhatsappConfigColumn(db);

    const sanitized: Partial<Record<UserRole, Permission[]>> = {};
    for (const [role, perms] of Object.entries(parsed.data.rolePermissions)) {
      if (role === 'admin') continue;
      sanitized[role as UserRole] = Array.from(
        new Set(perms.filter((p): p is Permission => validPermissions.includes(p as Permission)))
      );
    }

    const updatedMatrix = setRolePermissions(sanitized);
    const jsonPayload = JSON.stringify(updatedMatrix);

    const existing = await db.get('SELECT TOP 1 company_name FROM settings');
    if (existing) {
      await db.run('UPDATE settings SET role_permissions_json = ?', jsonPayload);
    } else {
      await db.run(
        `INSERT INTO settings (company_name, company_address, company_phone, company_email, tax_rate, currency, invoice_prefix, invoice_footer, role_permissions_json)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        'شركة المتحدة',
        'الشارع المقابل للبوابة الخلفية للمستشفى العام',
        '01001207474',
        'info@almuttahida.com',
        'جنيه',
        'INV',
        'شكراً للتعامل معنا - شركة المتحدة',
        jsonPayload
      );
    }

    await audit('settings.role_permissions.update', 'settings', 'role_permissions', req.user?.name || 'admin', updatedMatrix);
    broadcastDataChange('settings', 'update');
    return res.json({ message: 'تم تحديث صلاحيات الأدوار بنجاح', rolePermissions: updatedMatrix });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;