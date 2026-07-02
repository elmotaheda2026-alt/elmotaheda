import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
// Removed HelmetProvider import (handled in main.tsx)
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

import ProtectedRoute from './components/ProtectedRoute';
import WhatsappReminderRunner from './components/WhatsappReminderRunner';

function AppRoutes() {
  const { isAuthenticated, settings } = useAuth();

  return (
    <>
      <WhatsappReminderRunner enabled={isAuthenticated && settings.whatsappRemindersEnabled} />
      <Routes>
      <Route path="/login" element={isAuthenticated ? <Navigate to="/" /> : <Login />} />

      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<ProtectedRoute permission="dashboard:view"><Dashboard /></ProtectedRoute>} />
        <Route path="users" element={<ProtectedRoute permission="users:manage"><Users /></ProtectedRoute>} />
        <Route path="customers" element={<ProtectedRoute permission="sales:read"><Customers /></ProtectedRoute>} />
        <Route path="suppliers" element={<ProtectedRoute permission="sales:read"><Suppliers /></ProtectedRoute>} />
        <Route path="products-inventory" element={<ProtectedRoute permission="inventory:manage"><ProductsInventory /></ProtectedRoute>} />
        <Route path="sales" element={<ProtectedRoute permission="sales:read"><Sales /></ProtectedRoute>} />
        <Route path="invoices" element={<ProtectedRoute permission="sales:read"><Invoices /></ProtectedRoute>} />
        <Route path="payments" element={<ProtectedRoute permission="payments:read"><Payments /></ProtectedRoute>} />
        <Route path="expenses" element={<ProtectedRoute permission="payments:write"><Expenses /></ProtectedRoute>} />
        <Route path="accounts" element={<ProtectedRoute permission="payments:read"><Accounts /></ProtectedRoute>} />
        <Route path="reports" element={<ProtectedRoute permission="reports:read"><Reports /></ProtectedRoute>} />
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
