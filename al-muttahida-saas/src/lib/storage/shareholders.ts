import { Shareholder, ShareholderTransaction, Payment } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';
import { api, isApiMode } from '../apiClient';
import { createNotification } from './notifications';

export function getShareholders(): Shareholder[] {
  return getStorage<Shareholder>(DB_KEYS.SHAREHOLDERS);
}

export function getShareholderTransactions(): ShareholderTransaction[] {
  return getStorage<ShareholderTransaction>(DB_KEYS.SHAREHOLDER_TRANSACTIONS).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export async function syncShareholders(): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listShareholders();
  setStorage(DB_KEYS.SHAREHOLDERS, data);
}

export async function syncShareholderTransactions(): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listShareholderTransactions();
  setStorage(DB_KEYS.SHAREHOLDER_TRANSACTIONS, data);
}

export async function createShareholder(data: Omit<Shareholder, 'id' | 'createdAt' | 'updatedAt' | 'currentBalance' | 'capital'> & { capital?: number; joinedDate?: string; isFounder?: boolean }): Promise<Shareholder> {
  const capital = Number(data.capital || 0);
  const joinedDate = data.joinedDate || new Date().toISOString().split('T')[0];
  const isFounder = Boolean(data.isFounder);
  console.debug('[storage] createShareholder input capital:', data.capital, 'normalized:', capital);
  
  if (isApiMode()) {
    const res = await api.createShareholder({
      name: data.name,
      phone: data.phone,
      sharePercentage: data.sharePercentage,
      managementFeePercentage: data.managementFeePercentage,
      capital,
      joinedDate,
      isFounder,
      notes: data.notes,
    });
    const newShareholder: Shareholder = {
      ...data,
      id: res.id,
      capital,
      originalCapital: capital,
      joinedDate,
      isFounder,
      currentBalance: 0,
      createdAt: joinedDate,
      updatedAt: new Date().toISOString(),
    };
    const shareholders = getShareholders();
    shareholders.push(newShareholder);
    setStorage(DB_KEYS.SHAREHOLDERS, shareholders);
    console.debug('[storage] shareholders after create:', shareholders);
    return newShareholder;
  }

  const shareholders = getShareholders();
  const newShareholder: Shareholder = {
    ...data,
    id: generateId(),
    capital,
    originalCapital: capital,
    joinedDate,
    isFounder,
    currentBalance: 0,
    createdAt: joinedDate,
    updatedAt: new Date().toISOString(),
  };
  
  shareholders.push(newShareholder);
  setStorage(DB_KEYS.SHAREHOLDERS, shareholders);
  console.debug('[storage] shareholders after create:', shareholders);
  // NOTE: do NOT auto-create a capital transaction here —
  // creating a shareholder should only store the capital value.
  // Transactions must be created explicitly via addShareholderTransaction
  // to avoid duplicate updates or type coercion issues.
  
  return newShareholder;
}

export async function updateShareholder(id: string, updates: Partial<Shareholder>): Promise<Shareholder | null> {
  const shareholders = getShareholders();
  const index = shareholders.findIndex(s => s.id === id);
  if (index === -1) {
    return null;
  }

  if (isApiMode()) {
    await api.updateShareholder(id, updates);
  }

  shareholders[index] = { ...shareholders[index], ...updates, updatedAt: new Date().toISOString() };
  setStorage(DB_KEYS.SHAREHOLDERS, shareholders);
  return shareholders[index];
}

export async function deleteShareholder(id: string): Promise<boolean> {
  const shareholders = getShareholders();
  const filtered = shareholders.filter(s => s.id !== id);
  if (filtered.length !== shareholders.length) {
    if (isApiMode()) {
      await api.deleteShareholder(id);
    }
    setStorage(DB_KEYS.SHAREHOLDERS, filtered);
    return true;
  }
  return false;
}

export async function addShareholderTransaction(data: Omit<ShareholderTransaction, 'id' | 'createdAt' | 'date'> & { date?: string }): Promise<ShareholderTransaction | null> {
  const transactions = getShareholderTransactions();
  const shareholders = getShareholders();
  const index = shareholders.findIndex(s => s.id === data.shareholderId);
  
  if (index === -1) return null;
  const shareholder = shareholders[index];
  const txDate = data.date || new Date().toISOString().split('T')[0];
  
  if (isApiMode()) {
    const res = await api.createShareholderTransaction({
      ...data,
      date: txDate,
    });
    const newTx: ShareholderTransaction = {
      ...data,
      id: res.id,
      date: txDate,
      createdAt: new Date().toISOString()
    };
    
    // Update shareholder balance & capital
    if (data.type === 'capital_deposit') {
      shareholder.capital = Number(shareholder.capital || 0) + Number(data.amount || 0);
    } else if (data.type === 'capital_withdrawal') {
      shareholder.capital = Math.max(0, Number(shareholder.capital || 0) - Number(data.amount || 0));
    } else if (data.type === 'profit_distribution') {
      shareholder.currentBalance = Number(shareholder.currentBalance || 0) + Number(data.amount || 0);
    } else if (data.type === 'profit_withdrawal') {
      shareholder.currentBalance = Number(shareholder.currentBalance || 0) - Number(data.amount || 0);
    }
    const updatedShareholder = { ...shareholder, updatedAt: new Date().toISOString() };
    shareholders[index] = updatedShareholder;
    setStorage(DB_KEYS.SHAREHOLDERS, shareholders);
    
    transactions.push(newTx);
    setStorage(DB_KEYS.SHAREHOLDER_TRANSACTIONS, transactions);
    return newTx;
  }
  
  const newTx: ShareholderTransaction = {
    ...data,
    id: generateId(),
    date: txDate,
    createdAt: new Date().toISOString()
  };
  
  // Update shareholder balance & capital strictly separated
  if (data.type === 'capital_deposit') {
    shareholder.capital = Number(shareholder.capital || 0) + Number(data.amount || 0);
  } else if (data.type === 'capital_withdrawal') {
    shareholder.capital = Math.max(0, Number(shareholder.capital || 0) - Number(data.amount || 0));
  } else if (data.type === 'profit_distribution') {
    shareholder.currentBalance = Number(shareholder.currentBalance || 0) + Number(data.amount || 0);
  } else if (data.type === 'profit_withdrawal') {
    shareholder.currentBalance = Number(shareholder.currentBalance || 0) - Number(data.amount || 0);
  }
  const updatedShareholder = { ...shareholder, updatedAt: new Date().toISOString() };
  shareholders[index] = updatedShareholder;
  setStorage(DB_KEYS.SHAREHOLDERS, shareholders);

  transactions.push(newTx);
  setStorage(DB_KEYS.SHAREHOLDER_TRANSACTIONS, transactions);
  
  // Integrate with Treasury (Payments)
  if (data.type === 'capital_deposit' || data.type === 'capital_withdrawal' || data.type === 'profit_withdrawal') {
    const payments = getStorage<Payment>(DB_KEYS.PAYMENTS);
    const treasuryTx: Payment = {
      id: generateId(),
      type: data.type === 'capital_deposit' ? 'in' : 'out',
      amount: data.amount,
      referenceId: newTx.id,
      referenceType: 'other',
      description: `${data.description} - مساهم: ${shareholder.name}`,
      date: newTx.date,
      createdBy: data.createdBy,
      createdAt: newTx.createdAt
    };
    payments.push(treasuryTx);
    setStorage(DB_KEYS.PAYMENTS, payments);
    void createNotification({
      type: treasuryTx.type === 'in' ? 'success' : 'warning',
      title: `حركة شريك ${treasuryTx.type === 'in' ? 'وارد' : 'صادر'}`,
      message: `${treasuryTx.type === 'in' ? 'وارد' : 'صادر'} ${Number(treasuryTx.amount || 0).toLocaleString('ar-EG')} جنيه - ${shareholder.name}: ${data.description}`,
    });
  }

  return newTx;
}

export async function deleteShareholderTransaction(txId: string): Promise<ShareholderTransaction | null> {
  const transactions = getShareholderTransactions();
  const txIndex = transactions.findIndex(t => t.id === txId);
  if (txIndex === -1) return null;

  const tx = transactions[txIndex];
  const shareholders = getShareholders();
  const shIndex = shareholders.findIndex(s => s.id === tx.shareholderId);

  if (isApiMode()) {
    try {
      await api.deleteShareholderTransaction(txId);
    } catch (err) {
      console.error('Failed to delete shareholder transaction on API:', err);
      throw err;
    }
  }

  // Reverse the transaction effects on the shareholder
  if (shIndex !== -1) {
    const shareholder = shareholders[shIndex];
    if (tx.type === 'capital_deposit') {
      shareholder.capital = Math.max(0, Number(shareholder.capital || 0) - Number(tx.amount || 0));
    } else if (tx.type === 'capital_withdrawal') {
      shareholder.capital = Number(shareholder.capital || 0) + Number(tx.amount || 0);
    } else if (tx.type === 'profit_distribution') {
      shareholder.currentBalance = Math.max(0, Number(shareholder.currentBalance || 0) - Number(tx.amount || 0));
    } else if (tx.type === 'profit_withdrawal') {
      shareholder.currentBalance = Number(shareholder.currentBalance || 0) + Number(tx.amount || 0);
    }
    shareholders[shIndex] = { ...shareholder, updatedAt: new Date().toISOString() };
    setStorage(DB_KEYS.SHAREHOLDERS, shareholders);
  }

  // Remove associated treasury payment if exists
  const payments = getStorage(DB_KEYS.PAYMENTS) as any[];
  const payIndex = payments.findIndex(p => p.referenceId === tx.id);
  if (payIndex !== -1) {
    payments.splice(payIndex, 1);
    setStorage(DB_KEYS.PAYMENTS, payments);
  }

  // Remove the transaction
  transactions.splice(txIndex, 1);
  setStorage(DB_KEYS.SHAREHOLDER_TRANSACTIONS, transactions);

  return tx;
}


