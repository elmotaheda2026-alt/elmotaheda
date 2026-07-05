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
    <div className="min-h-screen bg-slate-100 text-slate-900 print:bg-white print:min-h-0">
      <div className="print:hidden">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </div>

      <div className={`transition-all duration-300 ${sidebarOpen ? 'lg:mr-72' : 'lg:mr-0'} print:m-0`}>
        <div className="print:hidden">
          <Header onMenuClick={toggleSidebar} />
        </div>

        <main className="px-4 pt-3 pb-6 md:px-8 md:pt-4 md:pb-8 print:p-0">
          <div className="mx-auto w-full max-w-[1720px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
