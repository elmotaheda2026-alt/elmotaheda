import React, { Suspense, lazy, useEffect } from 'react';
import companyLogo from './assets/company-logo-sm.jpg';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DialogProvider } from './context/DialogContext';
import Layout from './components/Layout';
import Login from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Users = lazy(() => import('./pages/Users'));
const Customers = lazy(() => import('./pages/Customers'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Sales = lazy(() => import('./pages/Sales'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Payments = lazy(() => import('./pages/Payments'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Settings = lazy(() => import('./pages/Settings'));
const Notifications = lazy(() => import('./pages/Notifications'));
const SalesReps = lazy(() => import('./pages/SalesReps'));
const CollectionStatement = lazy(() => import('./pages/CollectionStatement'));
const Shareholders = lazy(() => import('./pages/Shareholders'));
const ProductsInventory = lazy(() => import('./pages/ProductsInventory'));
const OnboardingWizard = lazy(() => import('./pages/OnboardingWizard'));

import ProtectedRoute from './components/ProtectedRoute';
import { isAdmin } from './lib/permissions';
import WhatsappReminderRunner from './components/WhatsappReminderRunner';
import LoadingState from './components/LoadingState';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Building2 } from 'lucide-react';

function AppRoutes() {
  const { isAuthenticated, user, settings, isLoading } = useAuth();
  const isNetworkWebBrowser =
    typeof window !== 'undefined' &&
    !(window as any).electronAPI &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';
  const isConfigured =
    isNetworkWebBrowser ||
    localStorage.getItem('almuttahida_configured') === 'true' ||
    settings.isConfigured;

  useEffect(() => {
    // Allow Ctrl+Shift+S/O for Admins (or when unauthenticated), and F2 only before login so it doesn't collide with form F2 shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      const canOpenOnboarding = !isAuthenticated || isAdmin(user);
      if (!canOpenOnboarding) return;
      if (
        (e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'o')) ||
        (!isAuthenticated && e.key === 'F2')
      ) {
        window.location.hash = '#/onboarding';
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    if (window.electronAPI && (window.electronAPI as any).onNavigate) {
      (window.electronAPI as any).onNavigate((route: string) => {
        window.location.hash = `#${route}`;
      });
    }

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthenticated, user]);

  if (isLoading) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-6"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #0f1f4a 55%, #172959 100%)' }}
        dir="rtl"
      >
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-[76px] h-[76px] rounded-[18px] overflow-hidden shadow-2xl border border-white/20 bg-[#0f245c]">
            <img
              src={companyLogo}
              alt="شركة المتحدة"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-[22px] font-bold text-white">شركة المتحدة</h2>
            <p className="text-xs text-slate-200/90">جاري التحقق من الجلسة ومزامنة النظام...</p>
          </div>
          <LoadingState size="md" />
        </div>
      </div>
    );
  }

  // If system is not configured yet, direct user to /onboarding
  if (!isConfigured) {
    return (
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingWizard />} />
          <Route path="*" element={<Navigate to="/onboarding" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<LoadingState />}>
      <WhatsappReminderRunner enabled={isAuthenticated && settings.whatsappRemindersEnabled} />
      <Routes>
        <Route path="/onboarding" element={<OnboardingWizard />} />
        <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <Login />} />

        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<ProtectedRoute permission="dashboard:view"><Dashboard /></ProtectedRoute>} />
          <Route path="users" element={<ProtectedRoute permission="users:manage"><Users /></ProtectedRoute>} />
          <Route path="customers" element={<ProtectedRoute permission="sales:read"><Customers /></ProtectedRoute>} />
          <Route path="suppliers" element={<ProtectedRoute permission="sales:read"><Suppliers /></ProtectedRoute>} />
          <Route path="products-inventory" element={<ProtectedRoute permission="inventory:manage"><ProductsInventory /></ProtectedRoute>} />
          <Route path="sales" element={<ProtectedRoute permission="reports:read"><Sales /></ProtectedRoute>} />
          <Route path="invoices" element={<ProtectedRoute permission="sales:read"><Invoices /></ProtectedRoute>} />
          <Route path="payments" element={<ProtectedRoute permission="payments:read"><Payments /></ProtectedRoute>} />
          <Route path="expenses" element={<ProtectedRoute permission="payments:write"><Expenses /></ProtectedRoute>} />
          <Route path="accounts" element={<ProtectedRoute permission="reports:read"><Accounts /></ProtectedRoute>} />
          <Route path="reports" element={<Navigate to="/accounts" replace />} />

          <Route path="settings" element={<ProtectedRoute permission="settings:manage"><Settings /></ProtectedRoute>} />
          <Route path="notifications" element={<ProtectedRoute permission="notifications:read"><Notifications /></ProtectedRoute>} />
          <Route path="sales-reps" element={<ProtectedRoute permission="sales:read"><SalesReps /></ProtectedRoute>} />
          <Route path="collection-statement" element={<ProtectedRoute permission="payments:read"><CollectionStatement /></ProtectedRoute>} />
          <Route path="shareholders" element={<ProtectedRoute permission="shareholders:manage"><Shareholders /></ProtectedRoute>} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DialogProvider>
          <HashRouter>
            <AppRoutes />
          </HashRouter>
        </DialogProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
