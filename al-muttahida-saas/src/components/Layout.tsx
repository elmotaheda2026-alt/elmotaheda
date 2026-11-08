import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('sidebar_open');
    return saved !== null ? saved === 'true' : true;
  });

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      localStorage.setItem('sidebar_open', String(next));
      return next;
    });
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex bg-slate-100 text-slate-900 print:block print:h-auto print:overflow-visible print:bg-white select-none">
      <div className="print:hidden shrink-0">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onToggle={toggleSidebar} />
      </div>

      <div className={`h-screen max-h-screen flex flex-col flex-1 min-w-0 transition-all duration-300 ${sidebarOpen ? 'lg:mr-60' : 'lg:mr-16'} print:m-0 overflow-hidden relative`}>
        <div className="print:hidden shrink-0 z-30 sticky top-0">
          <Header onMenuClick={toggleSidebar} />
        </div>

        <main className="flex-1 min-h-0 flex flex-col overflow-y-auto custom-scrollbar p-2 sm:p-2.5 md:p-3 print:h-auto print:overflow-visible print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
