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
  const capital = Number(data.capital || 0);
  console.debug('[storage] createShareholder input capital:', data.capital, 'normalized:', capital);
  
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
  console.debug('[storage] shareholders after create:', shareholders);
  // NOTE: do NOT auto-create a capital transaction here —
  // creating a shareholder should only store the capital value.
  // Transactions must be created explicitly via addShareholderTransaction
  // to avoid duplicate updates or type coercion issues.
  
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
    console.debug('[storage] addShareholderTransaction capital_deposit before:', shareholder.capital, 'amount:', data.amount);
    shareholder.capital = Number(shareholder.capital || 0) + Number(data.amount || 0);
    console.debug('[storage] addShareholderTransaction capital_deposit after:', shareholder.capital);
  } else if (data.type === 'capital_withdrawal') {
    shareholder.capital = Math.max(0, Number(shareholder.capital || 0) - Number(data.amount || 0));
  } else if (data.type === 'profit_distribution') {
    shareholder.currentBalance = Number(shareholder.currentBalance || 0) + Number(data.amount || 0);
  } else if (data.type === 'profit_withdrawal') {
    shareholder.currentBalance = Number(shareholder.currentBalance || 0) - Number(data.amount || 0);
  }
  const updatedShareholder = { ...shareholder, updatedAt: new Date().toISOString() };

  // If shareholder has zero capital and zero currentBalance after this tx, remove their record (card)
  const shouldRemove = Number(updatedShareholder.capital || 0) === 0 && Number(updatedShareholder.currentBalance || 0) === 0;
  if (shouldRemove) {
    console.debug('[storage] addShareholderTransaction removing shareholder (capital & balance zero):', updatedShareholder.id);
    shareholders.splice(index, 1);
    setStorage(DB_KEYS.SHAREHOLDERS, shareholders);
  } else {
    shareholders[index] = updatedShareholder;
    setStorage(DB_KEYS.SHAREHOLDERS, shareholders);
  }

  transactions.push(newTx);
  setStorage(DB_KEYS.SHAREHOLDER_TRANSACTIONS, transactions);
  
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

export function deleteShareholderTransaction(txId: string): ShareholderTransaction | null {
  const transactions = getShareholderTransactions();
  const txIndex = transactions.findIndex(t => t.id === txId);
  if (txIndex === -1) return null;

  const tx = transactions[txIndex];
  const shareholders = getShareholders();
  const shIndex = shareholders.findIndex(s => s.id === tx.shareholderId);

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

