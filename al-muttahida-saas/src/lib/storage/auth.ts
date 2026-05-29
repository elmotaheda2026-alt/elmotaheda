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
import { api, hasApiToken } from '../apiClient';

export function getUsers(): User[] {
  return getStorage<User>(DB_KEYS.USERS);
}

export async function syncUsers(): Promise<void> {
  if (hasApiToken()) {
    try {
      const data = await api.listUsers();
      setStorage(DB_KEYS.USERS, data);
    } catch (e) {
      console.error('Failed to sync users with API', e);
    }
  }
}

export async function createUser(user: Omit<User, 'id' | 'createdAt'>): Promise<User> {
  if (hasApiToken()) {
    try {
      const res = await api.createUser(user);
      const newUser: User = {
        ...user,
        id: res.id,
        createdAt: new Date().toISOString(),
      };
      const users = getStorage<User>(DB_KEYS.USERS);
      users.push(newUser);
      setStorage(DB_KEYS.USERS, users);
      return newUser;
    } catch (e) {
      console.error('API createUser failed, falling back to localStorage', e);
    }
  }

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

export async function updateUser(id: string, updates: Partial<User>): Promise<User | null> {
  if (hasApiToken()) {
    try {
      await api.updateUser(id, updates);
      const users = getStorage<User>(DB_KEYS.USERS);
      const index = users.findIndex((u) => u.id === id);
      if (index !== -1) {
        users[index] = { ...users[index], ...updates };
        setStorage(DB_KEYS.USERS, users);
        return users[index];
      }
    } catch (e) {
      console.error('API updateUser failed, falling back to localStorage cache', e);
    }
  }

  const users = getStorage<User>(DB_KEYS.USERS);
  const index = users.findIndex((u) => u.id === id);
  if (index !== -1) {
    users[index] = { ...users[index], ...updates };
    setStorage(DB_KEYS.USERS, users);
    return users[index];
  }
  return null;
}

export async function deleteUser(id: string): Promise<boolean> {
  if (hasApiToken()) {
    try {
      await api.deleteUser(id);
      const users = getStorage<User>(DB_KEYS.USERS);
      const filtered = users.filter((u) => u.id !== id);
      if (filtered.length !== users.length) {
        setStorage(DB_KEYS.USERS, filtered);
        return true;
      }
    } catch (e) {
      console.error('API deleteUser failed, falling back to localStorage cache', e);
    }
  }

  const users = getStorage<User>(DB_KEYS.USERS);
  const filtered = users.filter((u) => u.id !== id);
  if (filtered.length !== users.length) {
    setStorage(DB_KEYS.USERS, filtered);
    return true;
  }
  return false;
}
