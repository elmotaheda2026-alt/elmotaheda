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
    <div className="min-h-screen bg-slate-100 text-slate-900 print:block print:h-auto print:overflow-visible print:bg-white">
      <div className="print:hidden">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </div>

      <div className={`min-h-screen min-w-0 transition-all duration-300 ${sidebarOpen ? 'lg:mr-72' : 'lg:mr-0'} print:m-0`}>
        <div className={`print:hidden fixed top-0 left-0 right-0 z-30 transition-all duration-300 ${sidebarOpen ? 'lg:right-72' : 'lg:right-0'}`}>
          <Header onMenuClick={toggleSidebar} />
        </div>

        <main className="min-h-screen min-w-0 overflow-y-auto px-4 pb-6 pt-[84px] sm:px-6 md:pt-[92px] print:h-auto print:overflow-visible print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

