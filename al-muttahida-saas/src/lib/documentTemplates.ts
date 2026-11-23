import { Customer, Sale } from '../types';
import { api, isApiMode } from './apiClient';
import { formatDateDisplay } from './dateUtils';
import { tafqeet } from './tafqeet';
import { formatWholeCurrency } from './utils';
import { escapeHtml, sanitizeTemplateHtml } from './htmlUtils';

export type BuiltinTemplateKey =
  | 'creditApplication'
  | 'installmentStatement'
  | 'customerFile'
  | 'trustReceipt'
  | 'receiptAck'
  | 'lawyerAck';

export interface DocumentTemplate {
  id: string;
  templateKey: BuiltinTemplateKey | string | null;
  name: string;
  description: string;
  htmlContent: string;
  pageSize: 'A4' | 'thermal_80mm';
  isBuiltin: boolean;
  isActive: boolean;
  defaultChecked: boolean;
  repeatForSignatories: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TemplateSignatoryInfo {
  roleLabel: string;
  name: string;
  nationalId: string;
  phone: string;
  address: string;
}

export interface TemplateRenderContext {
  sale: Sale;
  customer: Customer | null;
  signatory: TemplateSignatoryInfo;
  firstPartyName: string;
  thirdPartyName: string;
  lawyerName: string;
  itemType: string;
  amount: number;
  amountInWords: string;
  currency?: string;
  companyName?: string;
  companyPhone?: string;
  companyAddress?: string;
  todayDate?: string;
}

export const BUILTIN_TEMPLATE_DEFAULTS: DocumentTemplate[] = [
  {
    id: 'builtin_creditApplication',
    templateKey: 'creditApplication',
    name: 'طلب شراء بالآجل (شامل التمويل والضامنين)',
    description: 'نموذج طلب شراء بالآجل شامل بيانات العميل والضامنين وجدول التمويل',
    htmlContent: '',
    pageSize: 'A4',
    isBuiltin: true,
    isActive: true,
    defaultChecked: true,
    repeatForSignatories: false,
    sortOrder: 1,
  },
  {
    id: 'builtin_installmentStatement',
    templateKey: 'installmentStatement',
    name: 'كشف حساب الأقساط وجدول السداد',
    description: 'ملخص المديونية وجدول مواعيد وقيم الأقساط الشهرية',
    htmlContent: '',
    pageSize: 'A4',
    isBuiltin: true,
    isActive: true,
    defaultChecked: true,
    repeatForSignatories: false,
    sortOrder: 2,
  },
  {
    id: 'builtin_customerFile',
    templateKey: 'customerFile',
    name: 'ملف العميل وبيان بيع السلعة',
    description: 'ملف بيانات الطرف الملتزم وبيان بيع السلعة بالتقسيط',
    htmlContent: '',
    pageSize: 'A4',
    isBuiltin: true,
    isActive: true,
    defaultChecked: true,
    repeatForSignatories: true,
    sortOrder: 3,
  },
  {
    id: 'builtin_trustReceipt',
    templateKey: 'trustReceipt',
    name: 'إيصال أمانة',
    description: 'إيصال أمانة قانوني بالمبلغ المستحق',
    htmlContent: '',
    pageSize: 'A4',
    isBuiltin: true,
    isActive: true,
    defaultChecked: true,
    repeatForSignatories: true,
    sortOrder: 4,
  },
  {
    id: 'builtin_receiptAck',
    templateKey: 'receiptAck',
    name: 'إقرار إستلام الأمانة نقداً',
    description: 'إقرار استلام المبلغ نقداً وتعهّد بالرد',
    htmlContent: '',
    pageSize: 'A4',
    isBuiltin: true,
    isActive: true,
    defaultChecked: true,
    repeatForSignatories: true,
    sortOrder: 5,
  },
  {
    id: 'builtin_lawyerAck',
    templateKey: 'lawyerAck',
    name: 'إقرارات توكيل قضايا (3 إقرارات)',
    description: '3 إقرارات توكيل محامٍ في صفحة واحدة',
    htmlContent: '',
    pageSize: 'A4',
    isBuiltin: true,
    isActive: true,
    defaultChecked: true,
    repeatForSignatories: true,
    sortOrder: 6,
  },
];

const LOCAL_STORAGE_KEY = 'almuttahida_document_templates_v1';

export async function loadDocumentTemplates(): Promise<DocumentTemplate[]> {
  if (isApiMode()) {
    try {
      const list = await api.listDocumentTemplates();
      if (Array.isArray(list) && list.length > 0) {
        return list;
      }
    } catch (err) {
      console.warn('Fallback to built-in document templates:', err);
    }
  }
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // Ignore invalid cached templates
  }
  return BUILTIN_TEMPLATE_DEFAULTS;
}

export async function saveLocalTemplatesFallback(list: DocumentTemplate[]): Promise<void> {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Ignore storage quota errors
  }
}

export const TEMPLATE_PLACEHOLDER_GROUPS = [
  {
    group: 'بيانات الطرف الموقع (العميل أو الضامن)',
    items: [
      { key: '{{signatory.roleLabel}}', label: 'صفة الموقع (عميل/ضامن)' },
      { key: '{{signatory.name}}', label: 'اسم الموقع' },
      { key: '{{signatory.nationalId}}', label: 'الرقم القومي للموقع' },
      { key: '{{signatory.phone}}', label: 'هاتف الموقع' },
      { key: '{{signatory.address}}', label: 'عنوان الموقع' },
    ],
  },
  {
    group: 'بيانات العميل والضامنين',
    items: [
      { key: '{{customer.name}}', label: 'اسم العميل' },
      { key: '{{customer.nationalId}}', label: 'الرقم القومي للعميل' },
      { key: '{{customer.phone}}', label: 'هاتف العميل' },
      { key: '{{customer.address}}', label: 'عنوان العميل' },
      { key: '{{guarantor1.name}}', label: 'اسم الضامن 1' },
      { key: '{{guarantor1.nationalId}}', label: 'رقم قومي ضامن 1' },
      { key: '{{guarantor1.phone}}', label: 'هاتف ضامن 1' },
      { key: '{{guarantor2.name}}', label: 'اسم الضامن 2' },
    ],
  },
  {
    group: 'بيانات الفاتورة والأقساط',
    items: [
      { key: '{{sale.invoiceNumber}}', label: 'رقم الفاتورة' },
      { key: '{{sale.date}}', label: 'تاريخ الفاتورة' },
      { key: '{{sale.total}}', label: 'إجمالي الفاتورة' },
      { key: '{{sale.paid}}', label: 'المقدم / المدفوع' },
      { key: '{{sale.remaining}}', label: 'المتبقي' },
      { key: '{{sale.remainingInWords}}', label: 'المتبقي بالحروف' },
      { key: '{{sale.installmentMonths}}', label: 'عدد الأقساط' },
      { key: '{{sale.monthlyInstallment}}', label: 'القسط الشهري' },
      { key: '{{itemType}}', label: 'نوع السلعة / الصنف' },
      { key: '{{amount}}', label: 'المبلغ المحدد للطباعة' },
      { key: '{{amountInWords}}', label: 'المبلغ بالحروف' },
      { key: '{{sale.itemsTable}}', label: 'جدول أصناف الفاتورة' },
      { key: '{{sale.installmentsTable}}', label: 'جدول الأقساط' },
    ],
  },
  {
    group: 'المتغيرات القانونية والشركة',
    items: [
      { key: '{{legal.firstPartyName}}', label: 'الطرف الأول (المُسلِّم)' },
      { key: '{{legal.thirdPartyName}}', label: 'الطرف الثالث (المُستلم منه)' },
      { key: '{{legal.lawyerName}}', label: 'اسم المحامي الموكّل' },
      { key: '{{company.name}}', label: 'اسم الشركة' },
      { key: '{{company.phone}}', label: 'هاتف الشركة' },
      { key: '{{company.address}}', label: 'عنوان الشركة' },
      { key: '{{todayDate}}', label: 'تاريخ اليوم' },
    ],
  },
];

export const PLACEHOLDER_LABEL_MAP: Record<string, string> = TEMPLATE_PLACEHOLDER_GROUPS.reduce(
  (acc, grp) => {
    for (const item of grp.items) {
      acc[item.key] = item.label;
    }
    return acc;
  },
  {} as Record<string, string>
);

export function createVariableChipHtml(token: string): string {
  const safeToken = escapeHtml(token);
  const label = escapeHtml(PLACEHOLDER_LABEL_MAP[token] || token.replace(/\{\{|\}\}/g, ''));
  return `<span class="tpl-var-chip" contenteditable="false" data-var="${safeToken}" style="display:inline-block;background:#dbeafe;color:#1e40af;border:1px solid #93c5fd;border-radius:6px;padding:0px 7px;margin:0 2px;font-weight:700;font-size:0.9em;user-select:all;cursor:default;">📌 ${label}</span>`;
}

export function tokensToVisualChips(html: string): string {
  if (!html) return '';
  return html.replace(/\{\{[a-zA-Z0-9_.]+\}\}/g, (match) => createVariableChipHtml(match));
}

export function visualChipsToTokens(visualHtml: string): string {
  if (!visualHtml) return '';
  if (typeof document === 'undefined') return visualHtml;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = visualHtml;
  const chips = wrapper.querySelectorAll('[data-var]');
  chips.forEach((chip) => {
    const token = chip.getAttribute('data-var') || '';
    const textNode = document.createTextNode(token);
    chip.parentNode?.replaceChild(textNode, chip);
  });
  return wrapper.innerHTML;
}

function buildItemsTableHtml(sale: Sale, currency: string): string {
  const items = sale.items || [];
  if (!items.length) return '<p style="font-size:12px;color:#64748b;">لا توجد أصناف</p>';
  const rows = items
    .map(
      (item, idx) => `
      <tr>
        <td style="border:1px solid #000;padding:5px 8px;text-align:center;">${idx + 1}</td>
        <td style="border:1px solid #000;padding:5px 8px;text-align:right;font-weight:700;">${escapeHtml(item.productName || '---')}</td>
        <td style="border:1px solid #000;padding:5px 8px;text-align:center;">${Number(item.quantity || 1)}</td>
        <td style="border:1px solid #000;padding:5px 8px;text-align:center;">${escapeHtml(formatWholeCurrency(Number(item.unitPrice || 0), currency))}</td>
        <td style="border:1px solid #000;padding:5px 8px;text-align:center;font-weight:700;">${escapeHtml(formatWholeCurrency(Number(item.total || 0), currency))}</td>
      </tr>`
    )
    .join('');

  return `
    <table style="width:100%;border-collapse:collapse;margin:10px 0;font-size:13px;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="border:1px solid #000;padding:6px;width:40px;">م</th>
          <th style="border:1px solid #000;padding:6px;text-align:right;">الصنف</th>
          <th style="border:1px solid #000;padding:6px;width:70px;">الكمية</th>
          <th style="border:1px solid #000;padding:6px;width:110px;">السعر</th>
          <th style="border:1px solid #000;padding:6px;width:120px;">الإجمالي</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function buildInstallmentsTableHtml(sale: Sale, currency: string): string {
  const schedule = sale.financing?.schedules || [];
  if (!schedule.length) return '<p style="font-size:12px;color:#64748b;">لا يوجد جدول أقساط</p>';
  const rows = schedule
    .map(
      (inst, idx) => `
      <tr>
        <td style="border:1px solid #000;padding:4px 6px;text-align:center;">${inst.monthIndex || idx + 1}</td>
        <td style="border:1px solid #000;padding:4px 6px;text-align:center;font-family:monospace;">${formatDateDisplay(inst.dueDate)}</td>
        <td style="border:1px solid #000;padding:4px 6px;text-align:center;font-weight:700;">${formatWholeCurrency(Number(inst.amount || 0), currency)}</td>
        <td style="border:1px solid #000;padding:4px 6px;text-align:center;">${inst.status === 'paid' ? 'مدفوع' : 'مستحق'}</td>
      </tr>`
    )
    .join('');

  return `
    <table style="width:100%;border-collapse:collapse;margin:10px 0;font-size:12px;">
      <thead>
        <tr style="background:#f1f5f9;">
          <th style="border:1px solid #000;padding:5px;width:55px;">القسط</th>
          <th style="border:1px solid #000;padding:5px;">تاريخ الاستحقاق</th>
          <th style="border:1px solid #000;padding:5px;">القيمة</th>
          <th style="border:1px solid #000;padding:5px;width:90px;">الحالة</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function renderTemplateHtml(htmlTemplate: string, ctx: TemplateRenderContext): string {
  const currency = ctx.currency || 'جنيه';
  const todayDate = ctx.todayDate || formatDateDisplay(new Date());
  const invoiceDate = formatDateDisplay(ctx.sale.date);
  const remaining = Number(ctx.sale.remaining ?? 0);
  const monthly =
    ctx.sale.financing?.monthlyInstallmentAmount ||
    (ctx.sale.financing?.installmentMonths && ctx.sale.financing.installmentMonths > 0
      ? Math.round(remaining / ctx.sale.financing.installmentMonths)
      : 0);

  const g1 = ctx.customer?.guarantors?.[0];
  const g2 = ctx.customer?.guarantors?.[1];

  const replacements: Record<string, string> = {
    '{{signatory.roleLabel}}': escapeHtml(ctx.signatory.roleLabel || 'العميل'),
    '{{signatory.name}}': escapeHtml(ctx.signatory.name || ctx.sale.customerName || '---'),
    '{{signatory.nationalId}}': escapeHtml(ctx.signatory.nationalId || '---'),
    '{{signatory.phone}}': escapeHtml(ctx.signatory.phone || '---'),
    '{{signatory.address}}': escapeHtml(ctx.signatory.address || '---'),

    '{{customer.name}}': escapeHtml(ctx.customer?.name || ctx.sale.customerName || '---'),
    '{{customer.nationalId}}': escapeHtml(ctx.customer?.nationalId || '---'),
    '{{customer.phone}}': escapeHtml(ctx.customer?.phone || '---'),
    '{{customer.address}}': escapeHtml(ctx.customer?.address || '---'),

    '{{guarantor1.name}}': escapeHtml(g1?.name || '---'),
    '{{guarantor1.nationalId}}': escapeHtml(g1?.nationalId || '---'),
    '{{guarantor1.phone}}': escapeHtml(g1?.phone || '---'),
    '{{guarantor2.name}}': escapeHtml(g2?.name || '---'),

    '{{sale.invoiceNumber}}': escapeHtml(ctx.sale.invoiceNumber || '---'),
    '{{sale.date}}': escapeHtml(invoiceDate),
    '{{sale.total}}': escapeHtml(formatWholeCurrency(Number(ctx.sale.total || 0), currency)),
    '{{sale.paid}}': escapeHtml(formatWholeCurrency(Number(ctx.sale.paid || 0), currency)),
    '{{sale.remaining}}': escapeHtml(formatWholeCurrency(remaining, currency)),
    '{{sale.remainingInWords}}': escapeHtml(tafqeet(remaining)),
    '{{sale.installmentMonths}}': escapeHtml(String(ctx.sale.financing?.installmentMonths || ctx.sale.financing?.schedules?.length || 0)),
    '{{sale.monthlyInstallment}}': escapeHtml(formatWholeCurrency(monthly, currency)),
    '{{itemType}}': escapeHtml(ctx.itemType || ctx.sale.items?.[0]?.productName || '---'),
    '{{amount}}': escapeHtml(formatWholeCurrency(Number(ctx.amount || 0), currency)),
    '{{amountInWords}}': escapeHtml(ctx.amountInWords || tafqeet(ctx.amount || 0)),
    '{{sale.itemsTable}}': buildItemsTableHtml(ctx.sale, currency),
    '{{sale.installmentsTable}}': buildInstallmentsTableHtml(ctx.sale, currency),

    '{{legal.firstPartyName}}': escapeHtml(ctx.firstPartyName || '---'),
    '{{legal.thirdPartyName}}': escapeHtml(ctx.thirdPartyName || '---'),
    '{{legal.lawyerName}}': escapeHtml(ctx.lawyerName || '---'),
    '{{company.name}}': escapeHtml(ctx.companyName || 'شركة المتحدة للتجارة'),
    '{{company.phone}}': escapeHtml(ctx.companyPhone || '01001207474'),
    '{{company.address}}': escapeHtml(ctx.companyAddress || ''),
    '{{todayDate}}': escapeHtml(todayDate),
  };

  let rendered = sanitizeTemplateHtml(htmlTemplate);
  for (const [token, value] of Object.entries(replacements)) {
    rendered = rendered.split(token).join(value);
  }
  return `<div class="a4-container" style="font-family:'Cairo',Tahoma,Arial,sans-serif;direction:rtl;color:#000;background:#fff;padding:12mm 15mm;box-sizing:border-box;">${rendered}</div><div class="page-break"></div>`;
}

export const DEFAULT_CUSTOM_TEMPLATE_HTML = `<div style="border:2px solid #000;padding:24px;border-radius:6px;min-height:245mm;display:flex;flex-direction:column;justify-content:space-between;">
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:10px;margin-bottom:18px;">
      <strong style="font-size:18px;">{{company.name}}</strong>
      <span style="font-size:12px;">التاريخ: {{todayDate}}</span>
    </div>

    <div style="text-align:center;margin-bottom:22px;">
      <span style="border:2.5px solid #000;padding:6px 32px;font-size:20px;font-weight:800;display:inline-block;box-shadow:3px 3px 0 #000;">
        إقرار وتعهد رسمي
      </span>
    </div>

    <div style="font-size:16px;line-height:2;text-align:justify;">
      <p>أقر أنا الموقع أدناه / <strong>{{signatory.name}}</strong>، المقيم في: <strong>{{signatory.address}}</strong>، وأحمل بطاقة رقم قومي رقم: <strong style="font-family:monospace;">{{signatory.nationalId}}</strong>، هاتف رقم: <strong style="font-family:monospace;">{{signatory.phone}}</strong>.</p>
      <p>بأنني استلمت من <strong>{{company.name}}</strong> السلعة/البضاعة الموضحة بالفاتورة رقم <strong>{{sale.invoiceNumber}}</strong> بتاريخ <strong>{{sale.date}}</strong>، وأن إجمالي المبلغ المستحق عليَّ هو <strong>{{sale.remaining}}</strong> (فقط <strong>{{sale.remainingInWords}}</strong> لا غير).</p>
    </div>

    {{sale.itemsTable}}
  </div>

  <div style="display:flex;justify-content:space-between;margin-top:30px;padding-top:16px;border-top:1px dashed #64748b;font-size:14px;font-weight:700;">
    <div style="text-align:center;width:45%;">
      <div>توقيع المقر بما فيه ({{signatory.roleLabel}})</div>
      <div style="margin-top:32px;border-bottom:1px solid #000;"></div>
    </div>
    <div style="text-align:center;width:45%;">
      <div>اعتماد الشركة</div>
      <div style="margin-top:32px;border-bottom:1px solid #000;"></div>
    </div>
  </div>
</div>`;

export function getBuiltinEditableStarterHtml(templateKey: string | null): string {
  switch (templateKey) {
    case 'trustReceipt':
      return `<div style="border:2px solid #000;padding:24px;border-radius:6px;">
  <div style="text-align:center;margin-bottom:20px;">
    <span style="border:2.5px solid #000;padding:6px 35px;font-size:22px;font-weight:800;box-shadow:4px 4px 0 #000;display:inline-block;">إيصال أمانة</span>
  </div>
  <div style="font-size:17px;line-height:2.1;">
    <p>استلمت أنا / <strong>{{signatory.name}}</strong></p>
    <p>المقيم في / <strong>{{signatory.address}}</strong> — رقم قومي / <strong style="font-family:monospace;">{{signatory.nationalId}}</strong></p>
    <p>من السيد / <strong>{{legal.firstPartyName}}</strong></p>
    <p>مبلغاً وقدره / <strong>{{amount}}</strong> (فقط <strong>{{amountInWords}}</strong> لا غير)</p>
    <p>وذلك على سبيل الأمانة لتوصيله إلى السيد / <strong>{{legal.thirdPartyName}}</strong>، وإذا لم أقم بتوصيله أكون مبدداً وخائناً للأمانة وأتحمل المسؤولية الجنائية والمدنية.</p>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:40px;font-weight:700;font-size:16px;">
    <div>توقيع المستلم: ...............................</div>
    <div>البصمة: ...............................</div>
  </div>
</div>`;
    case 'receiptAck':
      return `<div style="border:2px solid #000;padding:24px;border-radius:6px;">
  <div style="text-align:center;margin-bottom:20px;">
    <span style="border:2.5px solid #000;padding:6px 35px;font-size:22px;font-weight:800;box-shadow:4px 4px 0 #000;display:inline-block;">إقرار إستلام الأمانة نقداً</span>
  </div>
  <div style="font-size:17px;line-height:2.1;">
    <p>أقر أنا / <strong>{{signatory.name}}</strong> — رقم قومي: <strong style="font-family:monospace;">{{signatory.nationalId}}</strong></p>
    <p>المقيم في: <strong>{{signatory.address}}</strong></p>
    <p>بأنني استلمت مبلغاً وقدره <strong>{{amount}}</strong> (فقط <strong>{{amountInWords}}</strong>) نقداً، وأتعهد بسداده فور الطلب.</p>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:40px;font-weight:700;font-size:16px;">
    <div>التاريخ: {{todayDate}}</div>
    <div>توقيع المقر: ...............................</div>
  </div>
</div>`;
    case 'lawyerAck':
      return `<div style="border:2px solid #000;padding:22px;border-radius:6px;">
  <div style="text-align:center;margin-bottom:16px;">
    <span style="border:2.5px solid #000;padding:5px 30px;font-size:20px;font-weight:800;display:inline-block;">إقرار توكيل محامٍ</span>
  </div>
  <div style="font-size:16px;line-height:2;">
    <p>أقر أنا / <strong>{{signatory.name}}</strong> (رقم قومي: <strong style="font-family:monospace;">{{signatory.nationalId}}</strong>) بأنني أوكل المحامي الأستاذ / <strong>{{legal.lawyerName}}</strong> في اتخاذ كافة الإجراءات القانونية اللازمة بشأن المعاملة رقم <strong>{{sale.invoiceNumber}}</strong>.</p>
  </div>
  <div style="margin-top:30px;text-align:left;font-weight:700;">توقيع المقر: ...............................</div>
</div>`;
    default:
      return DEFAULT_CUSTOM_TEMPLATE_HTML;
  }
}
