import React, { useEffect, useRef, useState } from 'react';
import { sanitizeTemplateHtml } from '../lib/htmlUtils';
import {
  FileText,
  Plus,
  Edit3,
  Trash2,
  RotateCcw,
  Eye,
  CheckCircle2,
  X,
  Save,
  Users,
  Bold,
  Italic,
  Underline,
  AlignRight,
  AlignCenter,
  AlignLeft,
  Undo2,
  Redo2,
  Type,
  Wand2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import {
  DocumentTemplate,
  DEFAULT_CUSTOM_TEMPLATE_HTML,
  TEMPLATE_PLACEHOLDER_GROUPS,
  createVariableChipHtml,
  getBuiltinEditableStarterHtml,
  loadDocumentTemplates,
  renderTemplateHtml,
  saveLocalTemplatesFallback,
  tokensToVisualChips,
  visualChipsToTokens,
} from '../lib/documentTemplates';
import { api, isApiMode } from '../lib/apiClient';
import { Customer, Sale } from '../types';
import { useDialog } from '../context/DialogContext';

const SAMPLE_CUSTOMER: Customer = {
  id: 'sample_c1',
  customerNumber: 'CUST-1001',
  name: 'محمد طلعت أحمد',
  phone: '01097533684',
  address: 'كفر الشيخ - شارع جيهان - حي قباء',
  gender: 'male',
  city: 'كفر الشيخ',
  governorate: 'كفر الشيخ',
  region: 'حي قباء',
  dateOfBirth: '2002-10-16',
  nationalId: '30210161500614',
  age: 24,
  pensionDate: '2062-10-16',
  balance: 53084,
  balanceType: 'debtor',
  guarantors: [
    { name: 'أحمد علي حسن', phone: '01012345678', nationalId: '29505011500123', address: 'كفر الشيخ', relationship: 'أخ' },
    null,
    null,
  ],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const SAMPLE_SALE: Sale = {
  id: 'sample_s1',
  invoiceNumber: 'INV-1031',
  customerId: 'sample_c1',
  customerName: 'محمد طلعت أحمد',
  items: [
    {
      productId: 'p1',
      productName: 'توكتوك',
      quantity: 1,
      unitPrice: 64700,
      discount: 0,
      tax: 0,
      total: 64700,
    },
  ],
  subtotal: 64700,
  discount: 0,
  tax: 0,
  total: 64700,
  paid: 11616,
  remaining: 53084,
  status: 'pending',
  date: new Date().toISOString(),
  createdBy: 'المدير العام',
  createdAt: new Date().toISOString(),
  financing: {
    paymentMethod: 'installment',
    installmentMonths: 10,
    monthlyInstallmentAmount: 5308,
    schedules: [
      { id: 'i1', label: 'القسط 1', monthIndex: 1, dueDate: '2026-12-16', amount: 5308, paidAmount: 0, status: 'unpaid' },
      { id: 'i2', label: 'القسط 2', monthIndex: 2, dueDate: '2027-01-16', amount: 5308, paidAmount: 0, status: 'unpaid' },
    ],
  },
};

const QUICK_VARIABLES = [
  { key: '{{signatory.name}}', label: 'اسم العميل / الضامن' },
  { key: '{{signatory.nationalId}}', label: 'الرقم القومي' },
  { key: '{{signatory.address}}', label: 'العنوان' },
  { key: '{{signatory.phone}}', label: 'رقم الهاتف' },
  { key: '{{amount}}', label: 'المبلغ' },
  { key: '{{amountInWords}}', label: 'المبلغ بالحروف' },
  { key: '{{sale.invoiceNumber}}', label: 'رقم الفاتورة' },
  { key: '{{sale.itemsTable}}', label: 'جدول الأصناف' },
  { key: '{{sale.installmentsTable}}', label: 'جدول الأقساط' },
  { key: '{{legal.lawyerName}}', label: 'اسم المحامي' },
  { key: '{{todayDate}}', label: 'تاريخ اليوم' },
];

export default function DocumentTemplatesManager() {
  const { confirmDialog } = useDialog();
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Editor modal state
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null);
  const [isNewMode, setIsNewMode] = useState(false);
  const [editorMode, setEditorMode] = useState<'visual' | 'preview'>('visual');

  const [formName, setFormName] = useState('');
  const [formHtml, setFormHtml] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formDefaultChecked, setFormDefaultChecked] = useState(true);
  const [formRepeatForSignatories, setFormRepeatForSignatories] = useState(false);
  const [selectedTextNotice, setSelectedTextNotice] = useState<string>('');
  const [moreVarValue, setMoreVarValue] = useState<string>('');

  const visualEditorRef = useRef<HTMLDivElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const fetchTemplates = async () => {
    setLoading(true);
    try {
      const list = await loadDocumentTemplates();
      setTemplates(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTemplates();
  }, []);

  useEffect(() => {
    if ((isNewMode || editingTemplate) && editorMode === 'visual' && visualEditorRef.current) {
      visualEditorRef.current.innerHTML = sanitizeTemplateHtml(tokensToVisualChips(formHtml));
      savedRangeRef.current = null;
      setSelectedTextNotice('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode, isNewMode, editingTemplate]);

  const syncFromVisualEditor = (): string => {
    if (visualEditorRef.current) {
      const cleanHtml = sanitizeTemplateHtml(visualChipsToTokens(visualEditorRef.current.innerHTML));
      setFormHtml(cleanHtml);
      return cleanHtml;
    }
    return formHtml;
  };

  const handleModeSwitch = (nextMode: 'visual' | 'preview') => {
    if (editorMode === 'visual') {
      syncFromVisualEditor();
    }
    setEditorMode(nextMode);
  };

  const captureVisualSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !visualEditorRef.current) return;
    const range = sel.getRangeAt(0);
    if (visualEditorRef.current.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
      const selectedStr = sel.toString().trim();
      setSelectedTextNotice(selectedStr ? selectedStr.slice(0, 30) : '');
    }
  };

  const execWordCommand = (command: string, value?: string) => {
    if (editorMode !== 'visual' || !visualEditorRef.current) return;
    visualEditorRef.current.focus();
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRangeRef.current);
    }
    document.execCommand(command, false, value);
    syncFromVisualEditor();
    captureVisualSelection();
  };

  const insertPlaceholder = (token: string) => {
    if (!token) return;
    if (editorMode === 'preview') {
      setEditorMode('visual');
    }
    if (!visualEditorRef.current) return;

    visualEditorRef.current.focus();
    const sel = window.getSelection();
    let range = savedRangeRef.current;

    if (!range && sel && sel.rangeCount > 0 && visualEditorRef.current.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    }

    const temp = document.createElement('div');
    temp.innerHTML = createVariableChipHtml(token);
    const chipNode = temp.firstElementChild;
    if (!chipNode) return;

    if (range && visualEditorRef.current.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      const spaceAfter = document.createTextNode('\u00A0');
      range.insertNode(spaceAfter);
      range.insertNode(chipNode);
      const newRange = document.createRange();
      newRange.setStartAfter(spaceAfter);
      newRange.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(newRange);
      savedRangeRef.current = newRange;
    } else {
      visualEditorRef.current.appendChild(chipNode);
    }

    setSelectedTextNotice('');
    setMoreVarValue('');
    syncFromVisualEditor();
  };

  const openCreateModal = () => {
    setIsNewMode(true);
    setEditingTemplate(null);
    setEditorMode('visual');
    setFormName('');
    setFormHtml(DEFAULT_CUSTOM_TEMPLATE_HTML);
    setFormIsActive(true);
    setFormDefaultChecked(true);
    setFormRepeatForSignatories(false);
  };

  const openEditModal = (tpl: DocumentTemplate) => {
    setIsNewMode(false);
    setEditingTemplate(tpl);
    setEditorMode('visual');
    setFormName(tpl.name);
    setFormHtml(
      tpl.htmlContent && tpl.htmlContent.trim().length > 0
        ? tpl.htmlContent
        : tpl.isBuiltin
          ? getBuiltinEditableStarterHtml(tpl.templateKey)
          : DEFAULT_CUSTOM_TEMPLATE_HTML
    );
    setFormIsActive(tpl.isActive);
    setFormDefaultChecked(tpl.defaultChecked);
    setFormRepeatForSignatories(tpl.repeatForSignatories);
  };

  const closeEditor = () => {
    setEditingTemplate(null);
    setIsNewMode(false);
  };

  const handleSaveEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalHtml = editorMode === 'visual' ? syncFromVisualEditor() : formHtml;
    if (!formName.trim()) {
      showToast('من فضلك اكتب اسم المستند');
      return;
    }
    if (!finalHtml.trim()) {
      showToast('المستند فارغ، من فضلك اكتب محتوى المستند');
      return;
    }

    setSaving(true);
    try {
      if (isApiMode()) {
        if (isNewMode) {
          await api.createDocumentTemplate({
            name: formName.trim(),
            description: '',
            htmlContent: finalHtml,
            pageSize: 'A4',
            isActive: formIsActive,
            defaultChecked: formDefaultChecked,
            repeatForSignatories: formRepeatForSignatories,
            sortOrder: templates.length + 1,
          });
          showToast('تمت إضافة المستند الجديد وسيظهر الآن في نافذة الطباعة');
        } else if (editingTemplate) {
          await api.updateDocumentTemplate(editingTemplate.id, {
            name: formName.trim(),
            htmlContent: finalHtml,
            isActive: formIsActive,
            defaultChecked: formDefaultChecked,
            repeatForSignatories: formRepeatForSignatories,
          });
          showToast('تم حفظ تعديلات المستند بنجاح');
        }
        await fetchTemplates();
      } else {
        let updated: DocumentTemplate[];
        if (isNewMode) {
          const newItem: DocumentTemplate = {
            id: `tpl_${Date.now()}`,
            templateKey: null,
            name: formName.trim(),
            description: '',
            htmlContent: finalHtml,
            pageSize: 'A4',
            isBuiltin: false,
            isActive: formIsActive,
            defaultChecked: formDefaultChecked,
            repeatForSignatories: formRepeatForSignatories,
            sortOrder: templates.length + 1,
          };
          updated = [...templates, newItem];
        } else {
          updated = templates.map((t) =>
            t.id === editingTemplate?.id
              ? {
                  ...t,
                  name: formName.trim(),
                  htmlContent: finalHtml,
                  isActive: formIsActive,
                  defaultChecked: formDefaultChecked,
                  repeatForSignatories: formRepeatForSignatories,
                }
              : t
          );
        }
        setTemplates(updated);
        await saveLocalTemplatesFallback(updated);
        showToast('تم الحفظ بنجاح');
      }
      closeEditor();
    } catch (err: any) {
      showToast(err?.message || 'تعذر حفظ المستند');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickToggle = async (tpl: DocumentTemplate, field: 'isActive' | 'defaultChecked') => {
    const nextVal = !tpl[field];
    try {
      if (isApiMode()) {
        await api.updateDocumentTemplate(tpl.id, { [field]: nextVal });
        await fetchTemplates();
      } else {
        const updated = templates.map((t) => (t.id === tpl.id ? { ...t, [field]: nextVal } : t));
        setTemplates(updated);
        await saveLocalTemplatesFallback(updated);
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر تحديث الحالة');
    }
  };

  const handleMoveOrder = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= templates.length) return;
    const current = templates[index];
    const swapWith = templates[targetIndex];
    try {
      if (isApiMode()) {
        await Promise.all([
          api.updateDocumentTemplate(current.id, { sortOrder: targetIndex + 1 }),
          api.updateDocumentTemplate(swapWith.id, { sortOrder: index + 1 }),
        ]);
        await fetchTemplates();
      } else {
        const copy = [...templates];
        copy[index] = { ...swapWith, sortOrder: index + 1 };
        copy[targetIndex] = { ...current, sortOrder: targetIndex + 1 };
        setTemplates(copy);
        await saveLocalTemplatesFallback(copy);
      }
    } catch (err: any) {
      showToast(err?.message || 'تعذر تغيير الترتيب');
    }
  };

  const handleResetBuiltin = async (tpl: DocumentTemplate) => {
    const ok = await confirmDialog({
      title: 'استرجاع الشكل الأصلي',
      message: `هل تريد استرجاع الشكل الأصلي لمستند "${tpl.name}"؟`,
      type: 'warning',
    });
    if (!ok) return;
    try {
      if (isApiMode()) {
        await api.resetDocumentTemplate(tpl.id);
        await fetchTemplates();
      } else {
        const updated = templates.map((t) =>
          t.id === tpl.id ? { ...t, htmlContent: '', isActive: true, defaultChecked: true } : t
        );
        setTemplates(updated);
        await saveLocalTemplatesFallback(updated);
      }
      showToast('تم استرجاع الشكل الأصلي بنجاح');
    } catch (err: any) {
      showToast(err?.message || 'تعذر استرجاع الشكل الأصلي');
    }
  };

  const handleDeleteTemplate = async (tpl: DocumentTemplate) => {
    if (tpl.isBuiltin) return;
    const ok = await confirmDialog({
      title: 'حذف المستند',
      message: `هل أنت متأكد من حذف المستند "${tpl.name}"؟`,
      type: 'danger',
    });
    if (!ok) return;
    try {
      if (isApiMode()) {
        await api.deleteDocumentTemplate(tpl.id);
        await fetchTemplates();
      } else {
        const updated = templates.filter((t) => t.id !== tpl.id);
        setTemplates(updated);
        await saveLocalTemplatesFallback(updated);
      }
      showToast('تم حذف المستند');
    } catch (err: any) {
      showToast(err?.message || 'تعذر حذف المستند');
    }
  };

  const samplePreviewHtml = renderTemplateHtml(formHtml || DEFAULT_CUSTOM_TEMPLATE_HTML, {
    sale: SAMPLE_SALE,
    customer: SAMPLE_CUSTOMER,
    signatory: {
      roleLabel: 'العميل المشتري',
      name: SAMPLE_CUSTOMER.name,
      nationalId: SAMPLE_CUSTOMER.nationalId || '---',
      phone: SAMPLE_CUSTOMER.phone,
      address: SAMPLE_CUSTOMER.address || '---',
    },
    firstPartyName: 'مصطفى صبحي مصطفى بسيوني',
    thirdPartyName: 'احمد نشأت احمد محمد',
    lawyerName: 'عبدالفتاح عبدالفتاح السبع',
    itemType: 'توكتوك',
    amount: 53084,
    amountInWords: 'ثلاثة وخمسون ألفاً وأربعة وثمانون جنيهاً',
  });

  return (
    <div className="p-6 space-y-5" dir="rtl">
      {toast && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
        </div>
      )}

      {/* Clean Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
        <div>
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-blue-600" />
            <h3 className="font-black text-slate-800 text-base">مستندات وأوراق الفاتورة</h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            من هنا تقدر تعدّل كلام أي ورقة زي برنامج Word، أو تضيف ورقة جديدة تتطبع تلقائياً مع الفاتورة.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
        >
          <Plus size={16} />
          <span>إضافة ورقة / مستند جديد</span>
        </button>
      </div>

      {/* Templates List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-500">جاري تحميل المستندات...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {templates.map((tpl, idx) => {
            const hasCustomOverride = tpl.isBuiltin && tpl.htmlContent.trim().length > 0;
            return (
              <div
                key={tpl.id}
                className={`rounded-xl border p-4 transition-all ${
                  tpl.isActive ? 'bg-white border-slate-200 shadow-2xs' : 'bg-slate-50 border-slate-200/70 opacity-70'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-slate-900 text-sm truncate">{tpl.name}</h4>
                      {hasCustomOverride && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          معدّل
                        </span>
                      )}
                      {!tpl.isBuiltin && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          مستند جديد
                        </span>
                      )}
                      {tpl.repeatForSignatories && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 inline-flex items-center gap-1">
                          <Users size={10} /> للعميل والضامنين
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => handleMoveOrder(idx, -1)}
                      className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                      title="تقديم لأعلى"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      disabled={idx === templates.length - 1}
                      onClick={() => handleMoveOrder(idx, 1)}
                      className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-30 cursor-pointer"
                      title="تأخير لأسفل"
                    >
                      <ArrowDown size={13} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-100">
                  <div className="flex items-center gap-4 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={tpl.isActive}
                        onChange={() => handleQuickToggle(tpl, 'isActive')}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>يظهر في الطباعة</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={tpl.defaultChecked}
                        onChange={() => handleQuickToggle(tpl, 'defaultChecked')}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span>يتحدد تلقائياً</span>
                    </label>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditModal(tpl)}
                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Edit3 size={12} />
                      <span>تعديل الصيغة</span>
                    </button>

                    {hasCustomOverride && (
                      <button
                        type="button"
                        onClick={() => handleResetBuiltin(tpl)}
                        className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                        title="رجوع للشكل الأصلي"
                      >
                        <RotateCcw size={12} />
                        <span>الأصلي</span>
                      </button>
                    )}

                    {!tpl.isBuiltin && (
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(tpl)}
                        className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors cursor-pointer"
                        title="حذف المستند"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Word-like Visual Editor Modal */}
      {(isNewMode || editingTemplate) && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5">
          <div className="bg-white rounded-2xl w-full max-w-6xl max-h-[94vh] shadow-2xl flex flex-col overflow-hidden">
            {/* Modal Title */}
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h4 className="font-black text-slate-800 text-sm sm:text-base flex items-center gap-2">
                <FileText size={17} className="text-blue-600" />
                <span>{isNewMode ? 'إضافة ورقة / مستند جديد' : `تعديل: ${editingTemplate?.name}`}</span>
              </h4>
              <button
                type="button"
                onClick={closeEditor}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEditor} className="flex-1 overflow-y-auto p-5 space-y-3.5">
              {/* Simple Top Row: Document Name + Simple Switches */}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex-1 min-w-[240px]">
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم الورقة / المستند *</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="مثال: تعهد صيانة / عقد بيع / إقرار استلام"
                    className="w-full px-3.5 py-2 border border-slate-300 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    required
                  />
                </div>

                <div className="flex flex-wrap items-center gap-4 bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formIsActive}
                      onChange={(e) => setFormIsActive(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>يظهر في الطباعة</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formDefaultChecked}
                      onChange={(e) => setFormDefaultChecked(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>يتحدد تلقائياً</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formRepeatForSignatories}
                      onChange={(e) => setFormRepeatForSignatories(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>يتطبع لكل ضامن كمان</span>
                  </label>
                </div>
              </div>

              {/* Simple 2-Tab Switcher (Edit vs Print Preview) */}
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleModeSwitch('visual')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                      editorMode === 'visual'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <Type size={14} />
                    <span>تعديل الكلام والتنسيق</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeSwitch('preview')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
                      editorMode === 'preview'
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <Eye size={14} />
                    <span>معاينة شكل الورقة عند الطباعة</span>
                  </button>
                </div>
                <span className="text-[11px] text-slate-500 hidden sm:inline">
                  اكتب وامسح وعدّل مباشرة في الورقة البيضاء بالأسفل
                </span>
              </div>

              {editorMode === 'visual' ? (
                <div className="space-y-2.5">
                  {/* Unified Word Toolbar */}
                  <div className="bg-slate-100 border border-slate-300 rounded-xl p-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <button type="button" onClick={() => execWordCommand('bold')} className="p-1.5 rounded hover:bg-white text-slate-700" title="خط عريض">
                        <Bold size={15} />
                      </button>
                      <button type="button" onClick={() => execWordCommand('italic')} className="p-1.5 rounded hover:bg-white text-slate-700" title="خط مائل">
                        <Italic size={15} />
                      </button>
                      <button type="button" onClick={() => execWordCommand('underline')} className="p-1.5 rounded hover:bg-white text-slate-700" title="تحته خط">
                        <Underline size={15} />
                      </button>
                      <span className="w-px h-5 bg-slate-300 mx-1" />
                      <button type="button" onClick={() => execWordCommand('justifyRight')} className="p-1.5 rounded hover:bg-white text-slate-700" title="يمين">
                        <AlignRight size={15} />
                      </button>
                      <button type="button" onClick={() => execWordCommand('justifyCenter')} className="p-1.5 rounded hover:bg-white text-slate-700" title="في المنتصف">
                        <AlignCenter size={15} />
                      </button>
                      <button type="button" onClick={() => execWordCommand('justifyLeft')} className="p-1.5 rounded hover:bg-white text-slate-700" title="يسار">
                        <AlignLeft size={15} />
                      </button>
                      <span className="w-px h-5 bg-slate-300 mx-1" />
                      <select
                        defaultValue="3"
                        onChange={(e) => execWordCommand('fontSize', e.target.value)}
                        className="text-xs bg-white border border-slate-300 rounded-lg px-2 py-1 font-bold text-slate-700"
                        title="حجم الخط"
                      >
                        <option value="2">خط صغير</option>
                        <option value="3">خط عادي</option>
                        <option value="4">خط متوسط</option>
                        <option value="5">خط كبير</option>
                        <option value="6">عنوان رئيسي</option>
                      </select>
                      <button type="button" onClick={() => execWordCommand('undo')} className="p-1.5 rounded hover:bg-white text-slate-700" title="تراجع">
                        <Undo2 size={15} />
                      </button>
                      <button type="button" onClick={() => execWordCommand('redo')} className="p-1.5 rounded hover:bg-white text-slate-700" title="إعادة">
                        <Redo2 size={15} />
                      </button>
                    </div>

                    {/* More Variables Dropdown */}
                    <div className="flex items-center gap-1.5">
                      <Wand2 size={14} className="text-blue-600" />
                      <select
                        value={moreVarValue}
                        onChange={(e) => insertPlaceholder(e.target.value)}
                        className="text-xs font-bold bg-white border border-blue-300 rounded-lg px-2.5 py-1.5 text-blue-900 cursor-pointer"
                      >
                        <option value="">
                          {selectedTextNotice ? `حوّل "${selectedTextNotice}" إلى بيان تلقائي...` : '+ إضافة بيان تلقائي آخر...'}
                        </option>
                        {TEMPLATE_PLACEHOLDER_GROUPS.map((grp) => (
                          <optgroup key={grp.group} label={grp.group}>
                            {grp.items.map((item) => (
                              <option key={item.key} value={item.key}>
                                {item.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Single Clean Row of Most-Used Variables */}
                  <div className="bg-blue-50/70 border border-blue-200 rounded-xl px-3 py-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold text-blue-900 ml-1">
                      {selectedTextNotice
                        ? `اضغط على البيان لتحويل "${selectedTextNotice}":`
                        : 'بيانات تتعبّى لوحدها من الفاتورة (اقف بالماوس أو ظلّل كلمة واضغط):'}
                    </span>
                    {QUICK_VARIABLES.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => insertPlaceholder(item.key)}
                        className="px-2.5 py-1 bg-white hover:bg-blue-600 hover:text-white text-slate-700 border border-blue-200 rounded-lg text-[11px] font-bold transition-colors cursor-pointer"
                      >
                        + {item.label}
                      </button>
                    ))}
                  </div>

                  {/* Word-like White Paper */}
                  <div className="bg-slate-200/80 border border-slate-300 rounded-xl p-4 overflow-auto max-h-[430px]">
                    <div
                      ref={visualEditorRef}
                      contentEditable
                      suppressContentEditableWarning
                      dir="rtl"
                      onInput={syncFromVisualEditor}
                      onMouseUp={captureVisualSelection}
                      onKeyUp={captureVisualSelection}
                      className="bg-white text-black shadow-lg mx-auto max-w-[780px] min-h-[380px] p-6 rounded outline-none focus:ring-2 focus:ring-blue-500"
                      style={{ fontFamily: "'Cairo', Tahoma, Arial, sans-serif", lineHeight: 1.8 }}
                    />
                  </div>
                </div>
              ) : (
                <div className="border border-slate-300 rounded-xl bg-slate-200 p-4 overflow-auto max-h-[480px]">
                  <div
                    className="bg-white shadow-lg mx-auto max-w-[780px] rounded overflow-hidden"
                    dangerouslySetInnerHTML={{ __html: samplePreviewHtml }}
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Save size={14} />
                  <span>{saving ? 'جاري الحفظ...' : 'حفظ المستند'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
