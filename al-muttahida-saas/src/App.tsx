import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
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
import Reports from './pages/Reports';

import Settings from './pages/Settings';
import Notifications from './pages/Notifications';
import SalesReps from './pages/SalesReps';
import CollectionStatement from './pages/CollectionStatement';
import Shareholders from './pages/Shareholders';
import ProductsInventory from './pages/ProductsInventory';
import OnboardingWizard from './pages/OnboardingWizard';

import ProtectedRoute from './components/ProtectedRoute';
import WhatsappReminderRunner from './components/WhatsappReminderRunner';

function AppRoutes() {
  const { isAuthenticated, settings, isLoading } = useAuth();
  const isConfigured = localStorage.getItem('almuttahida_configured') === 'true' || settings.isConfigured;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center select-none" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 mb-4 animate-bounce">
          <span className="text-2xl font-black">المتحدة</span>
        </div>
        <h2 className="text-base font-bold text-slate-800">جاري تشغيل النظام...</h2>
        <p className="text-xs text-slate-400 mt-1">برجاء الانتظار قليلاً</p>
      </div>
    );
  }

  return (
    <>
      <WhatsappReminderRunner enabled={isAuthenticated && settings.whatsappRemindersEnabled} />
      <Routes>
        <Route path="/onboarding" element={<ProtectedRoute permission="settings:manage"><OnboardingWizard /></ProtectedRoute>} />
        <Route path="/login" element={isAuthenticated ? (isConfigured ? <Navigate to="/" /> : <Navigate to="/onboarding" />) : <Login />} />

        <Route path="/" element={<ProtectedRoute>{!isConfigured ? <Navigate to="/onboarding" replace /> : <Layout />}</ProtectedRoute>}>
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
          <Route path="reports" element={<ProtectedRoute adminOnly><Reports /></ProtectedRoute>} />

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
    <AuthProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AuthProvider>
  );
}
