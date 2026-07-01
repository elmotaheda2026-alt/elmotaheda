import fs from 'fs';

const filePath = 'al-muttahida-saas/src/pages/CollectionStatement.tsx';
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\r\n/g, "\n");

// 1. Add pagination helper function inside CollectionStatement component, right after totalDuePages declaration
const targetMath = `  const totalDuePages = Math.ceil(groupedDueRows.length / ITEMS_PER_PAGE);

  const paginatedGroupedDueRows = useMemo(() => {
    const startIndex = (dueCurrentPage - 1) * ITEMS_PER_PAGE;
    return groupedDueRows.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [groupedDueRows, dueCurrentPage]);`;

const replacementMath = `  const totalDuePages = Math.ceil(groupedDueRows.length / ITEMS_PER_PAGE);

  const paginatedGroupedDueRows = useMemo(() => {
    const startIndex = (dueCurrentPage - 1) * ITEMS_PER_PAGE;
    return groupedDueRows.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [groupedDueRows, dueCurrentPage]);

  // Generate pagination list with ellipses (...)
  const getPaginatedPages = () => {
    const pages: (number | string)[] = [];
    const range = 1; // Show current page +/- 1
    
    for (let i = 1; i <= totalDuePages; i++) {
      if (
        i === 1 ||
        i === totalDuePages ||
        (i >= dueCurrentPage - range && i <= dueCurrentPage + range)
      ) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '...') {
        pages.push('...');
      }
    }
    return pages;
  };`;

if (content.includes(targetMath)) {
  content = content.replace(targetMath, replacementMath);
  console.log("Added pagination ellipses helper function.");
}

// 2. Reduce card container spacing
const targetAccordionStart = `<div className="space-y-4 print:hidden">`;
const replacementAccordionStart = `<div className="space-y-2 print:hidden">`;

if (content.includes(targetAccordionStart)) {
  content = content.replace(targetAccordionStart, replacementAccordionStart);
  console.log("Reduced customer card list spacing.");
}

// 3. Compact card padding (p-5 -> p-3 px-4, p-5 border-t -> p-4 border-t)
const targetCardHeader = `                      <div
                        onClick={() => setExpandedCustomerSaleId(isExpanded ? null : group[0].saleId)}
                        className="p-5 flex items-center justify-between gap-4 flex-wrap cursor-pointer hover:bg-slate-50/50 transition-colors select-none print:bg-slate-50/30"
                      >`;

const replacementCardHeader = `                      <div
                        onClick={() => setExpandedCustomerSaleId(isExpanded ? null : group[0].saleId)}
                        className="p-3 px-4 flex items-center justify-between gap-4 flex-wrap cursor-pointer hover:bg-slate-50/50 transition-colors select-none print:bg-slate-50/30"
                      >`;

if (content.includes(targetCardHeader)) {
  content = content.replace(targetCardHeader, replacementCardHeader);
  console.log("Compacted card header padding.");
}

const targetCardBody = `                      {/* COLLAPSIBLE BODY */}
                      <div className={\`\${isExpanded ? 'block' : 'hidden print:block'} border-t border-slate-100 bg-slate-50/30 p-5 space-y-4\`}>`;

const replacementCardBody = `                      {/* COLLAPSIBLE BODY */}
                      <div className={\`\${isExpanded ? 'block' : 'hidden print:block'} border-t border-slate-100 bg-slate-50/30 p-4 space-y-3\`}>`;

if (content.includes(targetCardBody)) {
  content = content.replace(targetCardBody, replacementCardBody);
  console.log("Compacted card body padding.");
}

// 4. Redesign pagination controls to be inline and compact with ellipses
const targetPaginationControls = `            {/* Pagination Controls */}
            {totalDuePages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-4 rounded-2xl print:hidden">
                <div className="flex flex-1 justify-between sm:hidden">
                  <button
                    disabled={dueCurrentPage === 1}
                    onClick={() => {
                      setDueCurrentPage(prev => Math.max(prev - 1, 1));
                      setExpandedCustomerSaleId(null);
                    }}
                    className="relative inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    السابق
                  </button>
                  <button
                    disabled={dueCurrentPage === totalDuePages}
                    onClick={() => {
                      setDueCurrentPage(prev => Math.min(prev + 1, totalDuePages));
                      setExpandedCustomerSaleId(null);
                    }}
                    className="relative ml-3 inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    التالي
                  </button>
                </div>
                <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-slate-500 font-bold">
                      عرض <span className="text-slate-900">{Math.min(groupedDueRows.length, (dueCurrentPage - 1) * ITEMS_PER_PAGE + 1)}</span> إلى{' '}
                      <span className="text-slate-900">{Math.min(groupedDueRows.length, dueCurrentPage * ITEMS_PER_PAGE)}</span> من أصل{' '}
                      <span className="text-slate-900">{groupedDueRows.length}</span> عميل مستحق
                    </p>
                  </div>
                  <div>
                    <nav className="isolate inline-flex -space-x-px rounded-xl shadow-sm gap-1" aria-label="Pagination">
                      <button
                        disabled={dueCurrentPage === 1}
                        onClick={() => {
                          setDueCurrentPage(prev => Math.max(prev - 1, 1));
                          setExpandedCustomerSaleId(null);
                        }}
                        className="relative inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold"
                      >
                        السابق
                      </button>
                      {Array.from({ length: totalDuePages }).map((_, idx) => {
                        const pageNum = idx + 1;
                        return (
                          <button
                            key={pageNum}
                            onClick={() => {
                              setDueCurrentPage(pageNum);
                              setExpandedCustomerSaleId(null);
                            }}
                            className={\`relative inline-flex items-center rounded-xl px-3 py-1.5 text-xs font-bold focus:z-20 transition-all \${
                              dueCurrentPage === pageNum
                                ? 'bg-sky-600 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 shadow-sm'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }\`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                      <button
                        disabled={dueCurrentPage === totalDuePages}
                        onClick={() => {
                          setDueCurrentPage(prev => Math.min(prev + 1, totalDuePages));
                          setExpandedCustomerSaleId(null);
                        }}
                        className="relative inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-400 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-bold"
                      >
                        التالي
                      </button>
                    </nav>
                  </div>
                </div>
              </div>
            )}`;

const replacementPaginationControls = `            {/* Pagination Controls */}
            {totalDuePages > 1 && (
              <div className="flex items-center justify-between border border-slate-200/60 bg-white px-4 py-2.5 rounded-2xl print:hidden">
                <div>
                  <p className="text-xs text-slate-500 font-bold whitespace-nowrap">
                    عرض <span className="text-slate-900">{(dueCurrentPage - 1) * ITEMS_PER_PAGE + 1}</span> -{' '}
                    <span className="text-slate-900">{Math.min(groupedDueRows.length, dueCurrentPage * ITEMS_PER_PAGE)}</span> من{' '}
                    <span className="text-slate-900">{groupedDueRows.length}</span> عميل
                  </p>
                </div>
                <nav className="inline-flex rounded-xl gap-1" aria-label="Pagination">
                  <button
                    disabled={dueCurrentPage === 1}
                    onClick={() => {
                      setDueCurrentPage(prev => Math.max(prev - 1, 1));
                      setExpandedCustomerSaleId(null);
                    }}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold transition-all shadow-3sm"
                  >
                    السابق
                  </button>
                  {getPaginatedPages().map((page, idx) => {
                    if (page === '...') {
                      return (
                        <span key={\`dots-\${idx}\`} className="h-8 w-6 flex items-center justify-center text-slate-400 text-xs font-bold">
                          ...
                        </span>
                      );
                    }
                    return (
                      <button
                        key={\`page-\${page}\`}
                        onClick={() => {
                          setDueCurrentPage(page as number);
                          setExpandedCustomerSaleId(null);
                        }}
                        className={\`h-8 w-8 rounded-lg text-xs font-bold transition-all \${
                          dueCurrentPage === page
                            ? 'bg-sky-600 text-white shadow-sm'
                            : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-3sm'
                        }\`}
                      >
                        {page}
                      </button>
                    );
                  })}
                  <button
                    disabled={dueCurrentPage === totalDuePages}
                    onClick={() => {
                      setDueCurrentPage(prev => Math.min(prev + 1, totalDuePages));
                      setExpandedCustomerSaleId(null);
                    }}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] font-bold transition-all shadow-3sm"
                  >
                    التالي
                  </button>
                </nav>
              </div>
            )}`;

if (content.includes(targetPaginationControls)) {
  content = content.replace(targetPaginationControls, replacementPaginationControls);
  console.log("Replaced pagination controls with compact ellipsis design.");
} else {
  console.log("Could NOT find target pagination controls markup.");
}

fs.writeFileSync(filePath, content, 'utf8');
console.log("Done updating pagination UI.");
