import { Shareholder, ShareholderTransaction, Payment } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';

export function getShareholders(): Shareholder[] {
  return getStorage<Shareholder>(DB_KEYS.SHAREHOLDERS);
}

export function getShareholderTransactions(): ShareholderTransaction[] {
  return getStorage<ShareholderTransaction>(DB_KEYS.SHAREHOLDER_TRANSACTIONS).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function createShareholder(data: Omit<Shareholder, 'id' | 'createdAt' | 'updatedAt' | 'currentBalance' | 'capital'> & { capital?: number }): Shareholder {
  const shareholders = getShareholders();
  const capital = data.capital || 0;
  
  const newShareholder: Shareholder = {
    ...data,
    id: generateId(),
    capital,
    currentBalance: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  shareholders.push(newShareholder);
  setStorage(DB_KEYS.SHAREHOLDERS, shareholders);
  
  // If there's an initial capital, log a transaction automatically
  if (capital > 0) {
    addShareholderTransaction({
      shareholderId: newShareholder.id,
      shareholderName: newShareholder.name,
      type: 'capital_deposit',
      amount: capital,
      description: 'إيداع رأس مال افتتاحي',
      createdBy: 'النظام'
    });
  }
  
  return newShareholder;
}

export function updateShareholder(id: string, updates: Partial<Shareholder>): Shareholder | null {
  const shareholders = getShareholders();
  const index = shareholders.findIndex(s => s.id === id);
  if (index !== -1) {
    shareholders[index] = { ...shareholders[index], ...updates, updatedAt: new Date().toISOString() };
    setStorage(DB_KEYS.SHAREHOLDERS, shareholders);
    return shareholders[index];
  }
  return null;
}

export function deleteShareholder(id: string): boolean {
  const shareholders = getShareholders();
  const filtered = shareholders.filter(s => s.id !== id);
  if (filtered.length !== shareholders.length) {
    setStorage(DB_KEYS.SHAREHOLDERS, filtered);
    return true;
  }
  return false;
}

export function addShareholderTransaction(data: Omit<ShareholderTransaction, 'id' | 'createdAt' | 'date'>): ShareholderTransaction | null {
  const transactions = getShareholderTransactions();
  const shareholders = getShareholders();
  const index = shareholders.findIndex(s => s.id === data.shareholderId);
  
  if (index === -1) return null;
  const shareholder = shareholders[index];
  
  const newTx: ShareholderTransaction = {
    ...data,
    id: generateId(),
    date: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  
  // Update shareholder balance & capital
  if (data.type === 'capital_deposit') {
    shareholder.capital += data.amount;
  } else if (data.type === 'capital_withdrawal') {
    shareholder.capital = Math.max(0, shareholder.capital - data.amount);
  } else if (data.type === 'profit_distribution') {
    shareholder.currentBalance += data.amount;
  } else if (data.type === 'profit_withdrawal') {
    shareholder.currentBalance -= data.amount;
  }
  
  shareholders[index] = { ...shareholder, updatedAt: new Date().toISOString() };
  
  transactions.push(newTx);
  setStorage(DB_KEYS.SHAREHOLDER_TRANSACTIONS, transactions);
  setStorage(DB_KEYS.SHAREHOLDERS, shareholders);
  
  // Integrate with Treasury (Payments)
  // Deposit Capital -> Cash IN
  // Withdraw Capital / Withdraw Profit -> Cash OUT
  // Profit Distribution -> (Not a cash movement, just a ledger assignment)
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
  }

  return newTx;
}

