import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import {
  BookOpen,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  Printer,
  Search,
  Tag,
  X,
  ChevronLeft,
} from 'lucide-react';
import { PAGE_GUIDES, PageGuide, findGuideByPath } from '../data/pageGuides';

interface HelpGuideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

function buildPrintableManualHtml(guides: PageGuide[]): string {
  const sections = guides
    .map(
      (g) => `
      <section style="margin-bottom: 24px; padding: 16px 20px; border: 1px solid #cbd5e1; border-radius: 10px; page-break-inside: avoid;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0; padding-bottom:8px; margin-bottom:10px;">
          <h2 style="margin:0; font-size:17px; color:#0f172a;">${g.title}</h2>
          <span style="font-size:11px; color:#1e40af; background:#eff6ff; padding:2px 8px; border-radius:999px; font-weight:700;">${g.category}</span>
        </div>
        <p style="margin:0 0 10px; font-size:13px; color:#334155;">${g.summary}</p>
        <h3 style="margin:10px 0 6px; font-size:13px; color:#0f172a;">خطوات العمل:</h3>
        <ol style="margin:0 0 10px; padding-right:20px; font-size:12.5px; color:#1e293b; line-height:1.7;">
          ${g.steps.map((s) => `<li>${s}</li>`).join('')}
        </ol>
        ${
          g.keyTerms.length > 0
            ? `<h3 style="margin:10px 0 6px; font-size:13px; color:#0f172a;">مصطلحات وأزرار مهمة:</h3>
               <ul style="margin:0 0 10px; padding-right:18px; font-size:12.5px; color:#334155; line-height:1.65;">
                 ${g.keyTerms.map((t) => `<li><strong>${t.term}:</strong> ${t.meaning}</li>`).join('')}
               </ul>`
            : ''
        }
        ${
          g.tips.length > 0
            ? `<div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:8px 12px; font-size:12px; color:#92400e;">
                 <strong>تنبيهات عملية:</strong>
                 <ul style="margin:4px 0 0; padding-right:18px;">
                   ${g.tips.map((tip) => `<li>${tip}</li>`).join('')}
                 </ul>
               </div>`
            : ''
        }
      </section>
    `,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>دليل استخدام نظام شركة المتحدة للتجارة والتوريدات</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #0f172a; margin: 0; background: #fff; }
  </style>
</head>
<body>
  <header style="text-align:center; border-bottom:2px solid #1e40af; padding-bottom:14px; margin-bottom:22px;">
    <h1 style="margin:0 0 6px; font-size:22px; color:#1e40af;">دليل المستخدم العملي</h1>
    <p style="margin:0; font-size:13px; color:#475569;">شركة المتحدة للتجارة والتوريدات — شرح شاشات النظام وخطوات العمل اليومية</p>
  </header>
  ${sections}
</body>
</html>`;
}

export default function HelpGuideDrawer({ isOpen, onClose }: HelpGuideDrawerProps) {
  const location = useLocation();
  const currentRouteGuide = useMemo(() => findGuideByPath(location.pathname), [location.pathname]);
  const [activeTab, setActiveTab] = useState<'current' | 'all'>('current');
  const [selectedGuide, setSelectedGuide] = useState<PageGuide>(currentRouteGuide);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSelectedGuide(currentRouteGuide);
      setActiveTab('current');
      setSearchQuery('');
    }
  }, [isOpen, currentRouteGuide]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const filteredGuides = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return PAGE_GUIDES;
    return PAGE_GUIDES.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        g.summary.toLowerCase().includes(q) ||
        g.category.toLowerCase().includes(q) ||
        g.steps.some((s) => s.toLowerCase().includes(q)) ||
        g.keyTerms.some((t) => t.term.toLowerCase().includes(q) || t.meaning.toLowerCase().includes(q)),
    );
  }, [searchQuery]);

  const handlePrintFullManual = async () => {
    const html = buildPrintableManualHtml(PAGE_GUIDES);
    const electronPrint = (window as any).electronAPI?.printPreviewHtml;
    if (typeof electronPrint === 'function') {
      await electronPrint({ html, title: 'دليل المستخدم - شركة المتحدة', paperSize: 'a4' });
      return;
    }
    const win = window.open('', '_blank', 'width=960,height=760');
    if (win) {
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 300);
    }
  };

  if (!isOpen) return null;

  const displayGuide = activeTab === 'current' ? currentRouteGuide : selectedGuide;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex justify-end bg-slate-900/45 backdrop-blur-[2px] print:hidden"
      dir="rtl"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-xl bg-white shadow-2xl border-r border-slate-200 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-l from-slate-900 via-[#1e40af] to-[#1d4ed8] px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
              <BookOpen size={18} />
            </div>
            <div>
              <h2 className="text-base font-black">دليل المستخدم العملي</h2>
              <p className="text-[11px] text-blue-100 mt-0.5">
                شرح مبسط وخطوات واضحة لاستخدام شاشات النظام
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrintFullManual}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-bold transition-colors cursor-pointer"
              title="طباعة الدليل الشامل لجميع الصفحات"
            >
              <Printer size={14} />
              <span className="hidden sm:inline">طباعة الدليل</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
              title="إغلاق"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('current')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'current'
                ? 'bg-white text-blue-700 shadow-xs border border-blue-200'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <HelpCircle size={14} />
            <span>شرح الصفحة الحالية</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'all'
                ? 'bg-white text-blue-700 shadow-xs border border-blue-200'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <BookOpen size={14} />
            <span>جميع الصفحات ({PAGE_GUIDES.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          {activeTab === 'all' && (
            <div className="space-y-3">
              <div className="relative">
                <Search
                  size={15}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث عن صفحة أو مصطلح أو خطوة..."
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pr-10 pl-3.5 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-0.5">
                {filteredGuides.map((g) => {
                  const isSelected = selectedGuide.path === g.path;
                  return (
                    <button
                      key={g.path}
                      type="button"
                      onClick={() => setSelectedGuide(g)}
                      className={`text-right p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-blue-50 border-blue-300 text-blue-900 shadow-2xs'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{g.title}</p>
                        <p className="text-[10px] text-slate-500 truncate">{g.category}</p>
                      </div>
                      <ChevronLeft size={14} className="shrink-0 opacity-60" />
                    </button>
                  );
                })}
                {filteredGuides.length === 0 && (
                  <p className="col-span-2 text-center py-4 text-xs text-slate-400 font-semibold">
                    لا توجد نتائج مطابقة للبحث.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Selected Guide Details */}
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-base font-black text-slate-900">{displayGuide.title}</h3>
                <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800">
                  {displayGuide.category}
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">{displayGuide.summary}</p>
            </div>

            {/* Steps */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                <CheckCircle2 size={15} className="text-emerald-600" />
                <span>خطوات العمل العملية</span>
              </h4>
              <div className="space-y-2">
                {displayGuide.steps.map((step, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-slate-200/80"
                  >
                    <span className="w-6 h-6 rounded-lg bg-blue-600 text-white text-xs font-black flex items-center justify-center shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <p className="text-xs text-slate-700 leading-relaxed font-medium">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Key Terms */}
            {displayGuide.keyTerms.length > 0 && (
              <div className="space-y-2.5">
                <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                  <Tag size={15} className="text-indigo-600" />
                  <span>مصطلحات وأزرار مهمة في هذه الشاشة</span>
                </h4>
                <div className="space-y-2">
                  {displayGuide.keyTerms.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-indigo-50/50 border border-indigo-200/70 space-y-1"
                    >
                      <p className="text-xs font-black text-indigo-950">{item.term}</p>
                      <p className="text-xs text-slate-700 leading-relaxed">{item.meaning}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tips */}
            {displayGuide.tips.length > 0 && (
              <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 space-y-2">
                <h4 className="text-xs font-black text-amber-900 flex items-center gap-1.5">
                  <Lightbulb size={15} className="text-amber-600" />
                  <span>تنبيهات وحلول سريعة</span>
                </h4>
                <ul className="space-y-1.5 list-disc pr-4 text-xs text-amber-950 leading-relaxed">
                  {displayGuide.tips.map((tip, idx) => (
                    <li key={idx}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
