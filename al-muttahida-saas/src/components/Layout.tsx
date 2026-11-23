import React, { Suspense, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import UpdateBanner from './UpdateBanner';
import LoadingState from './LoadingState';
import { useAuth } from '../context/AuthContext';
import { startRealtimeSync, stopRealtimeSync } from '../lib/realtimeSync';
import { preloadAllRoutesInBackground } from '../lib/routePreloader';

export default function Layout() {
  const { settings, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      startRealtimeSync();
      preloadAllRoutesInBackground();
    } else {
      stopRealtimeSync();
    }
    return () => stopRealtimeSync();
  }, [isAuthenticated]);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      return false;
    }
    const saved = localStorage.getItem('sidebar_open');
    return saved !== null ? saved === 'true' : true;
  });

  useEffect(() => {
    const companyTitle =
      settings.companyName && settings.companyName !== 'شركة المتحدة'
        ? settings.companyName
        : 'شركة المتحدة للتجارة والتوريدات';
    document.title = companyTitle;
  }, [settings.companyName]);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      if (typeof window === 'undefined' || window.innerWidth >= 1024) {
        localStorage.setItem('sidebar_open', String(next));
      }
      return next;
    });
  };

  return (
    <div className="h-[100dvh] w-screen overflow-hidden flex bg-slate-100 text-slate-900 print:block print:h-auto print:overflow-visible print:bg-white select-none">
      <div className="print:hidden shrink-0">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onToggle={toggleSidebar} />
      </div>

      <div className={`h-[100dvh] max-h-[100dvh] flex flex-col flex-1 min-w-0 transition-all duration-300 ${sidebarOpen ? 'lg:mr-60' : 'lg:mr-16'} print:m-0 overflow-hidden relative`}>
        <div className="print:hidden shrink-0 z-20 sticky top-0">
          <UpdateBanner />
          <Header onMenuClick={toggleSidebar} />
        </div>

        <main className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden custom-scrollbar p-2 sm:p-2.5 md:p-3 print:h-auto print:overflow-visible print:p-0">
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
