import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 print:bg-white print:min-h-0">
      <div className="print:hidden">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </div>

      <div className="lg:mr-64 print:m-0">
        <div className="print:hidden">
          <Header onMenuClick={() => setSidebarOpen(true)} />
        </div>

        <main className="px-4 pt-2 pb-4 md:px-6 md:pt-3 md:pb-6 xl:px-8 print:p-0">
          <div className="mx-auto w-full max-w-[1720px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
