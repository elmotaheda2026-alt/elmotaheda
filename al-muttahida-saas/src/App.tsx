import React, { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DialogProvider } from './context/DialogContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Customers from './pages/Customers';
import Suppliers from './pages/Suppliers';
import Sales from './pages/Sales';
import Invoices from './pages/Invoices';
import Payments from './pages/Payments';
import Expenses from './pages/Expenses';
import Accounts from './pages/Accounts';

import Settings from './pages/Settings';
import Notifications from './pages/Notifications';
import SalesReps from './pages/SalesReps';
import CollectionStatement from './pages/CollectionStatement';
import Shareholders from './pages/Shareholders';
import ProductsInventory from './pages/ProductsInventory';
import OnboardingWizard from './pages/OnboardingWizard';

import ProtectedRoute from './components/ProtectedRoute';
import WhatsappReminderRunner from './components/WhatsappReminderRunner';
import LoadingState from './components/LoadingState';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Building2 } from 'lucide-react';

function AppRoutes() {
  const { isAuthenticated, settings, isLoading } = useAuth();
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
    // Keyboard shortcut (Ctrl + Shift + S or F2) to open Setup / Onboarding anytime
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'o')) ||
        e.key === 'F2'
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
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6" dir="rtl">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-700 to-indigo-800 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 animate-pulse">
            <Building2 className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-800">شركة المتحدة ERP</h2>
            <p className="text-xs text-slate-500">جاري التحقق من الجلسة ومزامنة النظام...</p>
          </div>
          <LoadingState size="lg" />
        </div>
      </div>
    );
  }

  // If system is not configured yet, direct user to /onboarding
  if (!isConfigured) {
    return (
      <Routes>
        <Route path="/onboarding" element={<OnboardingWizard />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  return (
    <>
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
          <Route path="sales" element={<ProtectedRoute adminOnly><Sales /></ProtectedRoute>} />
          <Route path="invoices" element={<ProtectedRoute permission="sales:read"><Invoices /></ProtectedRoute>} />
          <Route path="payments" element={<ProtectedRoute permission="payments:read"><Payments /></ProtectedRoute>} />
          <Route path="expenses" element={<ProtectedRoute permission="payments:write"><Expenses /></ProtectedRoute>} />
          <Route path="accounts" element={<ProtectedRoute adminOnly><Accounts /></ProtectedRoute>} />
          <Route path="reports" element={<Navigate to="/accounts" replace />} />

          <Route path="settings" element={<ProtectedRoute permission="settings:manage"><Settings /></ProtectedRoute>} />
          <Route path="notifications" element={<ProtectedRoute permission="notifications:read"><Notifications /></ProtectedRoute>} />
          <Route path="sales-reps" element={<ProtectedRoute permission="sales:read"><SalesReps /></ProtectedRoute>} />
          <Route path="collection-statement" element={<ProtectedRoute permission="payments:read"><CollectionStatement /></ProtectedRoute>} />
          <Route path="shareholders" element={<ProtectedRoute permission="shareholders:manage"><Shareholders /></ProtectedRoute>} />
        </Route>
      </Routes>
    </>
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
