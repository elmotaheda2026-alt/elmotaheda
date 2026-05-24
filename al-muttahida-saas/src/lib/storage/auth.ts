import { User } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';

// Auth Functions
export function login(email: string, password: string): User | null {
  const users = getStorage<User>(DB_KEYS.USERS);
  const user = users.find((u) => u.email === email && u.password === password && u.isActive);
  if (user) {
    user.lastLogin = new Date().toISOString();
    setStorage(DB_KEYS.USERS, users);
    localStorage.setItem(DB_KEYS.AUTH, JSON.stringify(user));
    return user;
  }
  return null;
}

export function logout(): void {
  localStorage.removeItem(DB_KEYS.AUTH);
}

export function getCurrentUser(): User | null {
  const auth = localStorage.getItem(DB_KEYS.AUTH);
  return auth ? JSON.parse(auth) : null;
}

// Users CRUD
export function getUsers(): User[] {
  return getStorage<User>(DB_KEYS.USERS);
}

export function createUser(user: Omit<User, 'id' | 'createdAt'>): User {
  const users = getStorage<User>(DB_KEYS.USERS);
  const newUser: User = {
    ...user,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  setStorage(DB_KEYS.USERS, users);
  return newUser;
}

export function updateUser(id: string, updates: Partial<User>): User | null {
  const users = getStorage<User>(DB_KEYS.USERS);
  const index = users.findIndex((u) => u.id === id);
  if (index !== -1) {
    users[index] = { ...users[index], ...updates };
    setStorage(DB_KEYS.USERS, users);
    return users[index];
  }
  return null;
}

export function deleteUser(id: string): boolean {
  const users = getStorage<User>(DB_KEYS.USERS);
  const filtered = users.filter((u) => u.id !== id);
  if (filtered.length !== users.length) {
    setStorage(DB_KEYS.USERS, filtered);
    return true;
  }
  return false;
}
