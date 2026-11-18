import { Router } from 'express';
import { z } from 'zod';
import { dbPromise } from '../db.js';
import { requireAuth, requirePermission, type AuthedRequest } from '../middleware/auth.js';
import { audit } from '../audit.js';

const router = Router();
router.use(requireAuth);

export interface BuiltinTemplateSeed {
  id: string;
  templateKey: string;
  name: string;
  description: string;
  repeatForSignatories: boolean;
  sortOrder: number;
}

const BUILTIN_TEMPLATES: BuiltinTemplateSeed[] = [
  {
    id: 'builtin_creditApplication',
    templateKey: 'creditApplication',
    name: 'طلب شراء بالآجل (شامل التمويل والضامنين)',
    description: 'نموذج طلب شراء بالآجل شامل بيانات العميل والضامنين وجدول التمويل',
    repeatForSignatories: false,
    sortOrder: 1,
  },
  {
    id: 'builtin_installmentStatement',
    templateKey: 'installmentStatement',
    name: 'كشف حساب الأقساط وجدول السداد',
    description: 'ملخص المديونية وجدول مواعيد وقيم الأقساط الشهرية',
    repeatForSignatories: false,
    sortOrder: 2,
  },
  {
    id: 'builtin_customerFile',
    templateKey: 'customerFile',
    name: 'ملف العميل وبيان بيع السلعة',
    description: 'ملف بيانات الطرف الملتزم وبيان بيع السلعة بالتقسيط',
    repeatForSignatories: true,
    sortOrder: 3,
  },
  {
    id: 'builtin_trustReceipt',
    templateKey: 'trustReceipt',
    name: 'إيصال أمانة',
    description: 'إيصال أمانة قانوني بالمبلغ المستحق',
    repeatForSignatories: true,
    sortOrder: 4,
  },
  {
    id: 'builtin_receiptAck',
    templateKey: 'receiptAck',
    name: 'إقرار إستلام الأمانة نقداً',
    description: 'إقرار استلام المبلغ نقداً وتعهّد بالرد',
    repeatForSignatories: true,
    sortOrder: 5,
  },
  {
    id: 'builtin_lawyerAck',
    templateKey: 'lawyerAck',
    name: 'إقرارات توكيل قضايا (3 إقرارات)',
    description: '3 إقرارات توكيل محامٍ في صفحة واحدة',
    repeatForSignatories: true,
    sortOrder: 6,
  },
];

async function ensureBuiltinTemplatesSeeded(db: any) {
  const now = new Date().toISOString();
  for (const tpl of BUILTIN_TEMPLATES) {
    const exists = await db.get(
      'SELECT id FROM document_templates WHERE template_key = ? OR id = ?',
      tpl.templateKey,
      tpl.id
    );
    if (!exists) {
      await db.run(
        `INSERT INTO document_templates
         (id, template_key, name, description, html_content, page_size, is_builtin, is_active, default_checked, repeat_for_signatories, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, N'', 'A4', 1, 1, 1, ?, ?, ?, ?)`,
        tpl.id,
        tpl.templateKey,
        tpl.name,
        tpl.description,
        tpl.repeatForSignatories ? 1 : 0,
        tpl.sortOrder,
        now,
        now
      );
    }
  }
}

function mapTemplateRow(row: any) {
  return {
    id: String(row.id),
    templateKey: row.template_key ? String(row.template_key) : null,
    name: String(row.name),
    description: row.description ? String(row.description) : '',
    htmlContent: row.html_content ? String(row.html_content) : '',
    pageSize: row.page_size === 'thermal_80mm' ? 'thermal_80mm' : 'A4',
    isBuiltin: Boolean(row.is_builtin),
    isActive: Boolean(row.is_active),
    defaultChecked: Boolean(row.default_checked),
    repeatForSignatories: Boolean(row.repeat_for_signatories),
    sortOrder: Number(row.sort_order ?? 100),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

const createTemplateSchema = z.object({
  name: z.string().min(1, 'اسم المستند مطلوب'),
  description: z.string().optional().default(''),
  htmlContent: z.string().min(1, 'محتوى القالب مطلوب'),
  pageSize: z.enum(['A4', 'thermal_80mm']).optional().default('A4'),
  isActive: z.boolean().optional().default(true),
  defaultChecked: z.boolean().optional().default(true),
  repeatForSignatories: z.boolean().optional().default(false),
  sortOrder: z.number().int().optional().default(50),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  htmlContent: z.string().optional(),
  pageSize: z.enum(['A4', 'thermal_80mm']).optional(),
  isActive: z.boolean().optional(),
  defaultChecked: z.boolean().optional(),
  repeatForSignatories: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// GET /document-templates
router.get('/', async (_req, res) => {
  try {
    const db = await dbPromise;
    await ensureBuiltinTemplatesSeeded(db);
    const rows = await db.all(
      'SELECT * FROM document_templates ORDER BY sort_order ASC, created_at ASC'
    );
    return res.json(rows.map(mapTemplateRow));
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /document-templates
router.post('/', requirePermission('settings:manage'), async (req: AuthedRequest, res) => {
  const parsed = createTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'بيانات القالب غير صالحة', errors: parsed.error.format() });
  }

  const data = parsed.data;
  const now = new Date().toISOString();
  const id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  try {
    const db = await dbPromise;
    await ensureBuiltinTemplatesSeeded(db);
    await db.run(
      `INSERT INTO document_templates
       (id, template_key, name, description, html_content, page_size, is_builtin, is_active, default_checked, repeat_for_signatories, sort_order, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      id,
      data.name.trim(),
      data.description.trim(),
      data.htmlContent,
      data.pageSize,
      data.isActive ? 1 : 0,
      data.defaultChecked ? 1 : 0,
      data.repeatForSignatories ? 1 : 0,
      data.sortOrder,
      now,
      now
    );

    const created = await db.get('SELECT * FROM document_templates WHERE id = ?', id);
    await audit('document_template.create', 'document_templates', id, req.user?.name || 'system', { name: data.name });
    return res.status(201).json(mapTemplateRow(created));
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// PUT /document-templates/:id
router.put('/:id', requirePermission('settings:manage'), async (req: AuthedRequest, res) => {
  const { id } = req.params;
  const parsed = updateTemplateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'بيانات التحديث غير صالحة', errors: parsed.error.format() });
  }

  try {
    const db = await dbPromise;
    await ensureBuiltinTemplatesSeeded(db);
    const existing = await db.get('SELECT * FROM document_templates WHERE id = ?', id);
    if (!existing) {
      return res.status(404).json({ message: 'القالب غير موجود' });
    }

    const d = parsed.data;
    const now = new Date().toISOString();

    await db.run(
      `UPDATE document_templates
       SET name = ?,
           description = ?,
           html_content = ?,
           page_size = ?,
           is_active = ?,
           default_checked = ?,
           repeat_for_signatories = ?,
           sort_order = ?,
           updated_at = ?
       WHERE id = ?`,
      d.name !== undefined ? d.name.trim() : existing.name,
      d.description !== undefined ? d.description.trim() : existing.description,
      d.htmlContent !== undefined ? d.htmlContent : existing.html_content,
      d.pageSize !== undefined ? d.pageSize : existing.page_size,
      d.isActive !== undefined ? (d.isActive ? 1 : 0) : existing.is_active,
      d.defaultChecked !== undefined ? (d.defaultChecked ? 1 : 0) : existing.default_checked,
      d.repeatForSignatories !== undefined ? (d.repeatForSignatories ? 1 : 0) : existing.repeat_for_signatories,
      d.sortOrder !== undefined ? d.sortOrder : existing.sort_order,
      now,
      id
    );

    const updated = await db.get('SELECT * FROM document_templates WHERE id = ?', id);
    await audit('document_template.update', 'document_templates', id, req.user?.name || 'system', { name: updated.name });
    return res.json(mapTemplateRow(updated));
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// POST /document-templates/:id/reset
router.post('/:id/reset', requirePermission('settings:manage'), async (req: AuthedRequest, res) => {
  const { id } = req.params;
  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT * FROM document_templates WHERE id = ?', id);
    if (!existing) {
      return res.status(404).json({ message: 'القالب غير موجود' });
    }
    if (!existing.is_builtin) {
      return res.status(400).json({ message: 'الاستعادة متاحة فقط للقوالب الأساسية' });
    }

    const seed = BUILTIN_TEMPLATES.find((b) => b.id === id || b.templateKey === existing.template_key);
    const now = new Date().toISOString();
    await db.run(
      `UPDATE document_templates
       SET name = ?,
           description = ?,
           html_content = N'',
           page_size = 'A4',
           is_active = 1,
           default_checked = 1,
           repeat_for_signatories = ?,
           sort_order = ?,
           updated_at = ?
       WHERE id = ?`,
      seed?.name || existing.name,
      seed?.description || existing.description,
      seed?.repeatForSignatories ? 1 : 0,
      seed?.sortOrder ?? existing.sort_order,
      now,
      id
    );

    const updated = await db.get('SELECT * FROM document_templates WHERE id = ?', id);
    await audit('document_template.reset', 'document_templates', id, req.user?.name || 'system', {});
    return res.json(mapTemplateRow(updated));
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

// DELETE /document-templates/:id
router.delete('/:id', requirePermission('settings:manage'), async (req: AuthedRequest, res) => {
  const { id } = req.params;
  try {
    const db = await dbPromise;
    const existing = await db.get('SELECT * FROM document_templates WHERE id = ?', id);
    if (!existing) {
      return res.status(404).json({ message: 'القالب غير موجود' });
    }
    if (existing.is_builtin) {
      return res.status(400).json({ message: 'لا يمكن حذف القوالب الأساسية، يمكنك تعطيلها فقط.' });
    }

    await db.run('DELETE FROM document_templates WHERE id = ?', id);
    await audit('document_template.delete', 'document_templates', id, req.user?.name || 'system', { name: existing.name });
    return res.json({ message: 'تم حذف القالب بنجاح' });
  } catch (error: any) {
    return res.status(500).json({ message: error.message || 'Database error' });
  }
});

export default router;

