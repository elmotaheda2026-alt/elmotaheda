import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Permission, User, Setting, UserPermissions } from '../types';
import * as db from '../lib/storage';
import { api, clearApiToken, getApiUser, isApiMode, setApiSession } from '../lib/apiClient';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  settings: Setting;
  updateSettings: (settings: Setting) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Setting>(db.getSettings());

  useEffect(() => {
    if (isApiMode()) {
      setUser(getApiUser<User>());
      return;
    }

    db.initializeDatabase();
    setUser(db.getCurrentUser());
  }, []);

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const { token, user: apiUser } = await api.login(username, password);
      const permissions = Array.isArray(apiUser.permissions)
        ? apiUser.permissions.reduce<UserPermissions>((acc, permission) => {
            acc[permission as Permission] = true;
            return acc;
          }, {})
        : apiUser.permissions as UserPermissions | undefined;
      const mappedUser: User = {
        id: apiUser.id,
        name: apiUser.name,
        username,
        password: '',
        role: apiUser.role as User['role'],
        permissions,
        createdAt: new Date().toISOString(),
        isActive: true,
      };
      setApiSession(token, mappedUser);
      setUser(mappedUser);
      return true;
    } catch (e) {
      // Attempt to fallback to local storage login regardless of mode
      console.warn('API login failed, attempting local fallback', e);
      // Ensure database is initialized for local fallback
      db.initializeDatabase();
      const loggedInUser = db.login(username, password);
      if (loggedInUser) {
        setUser(loggedInUser);
        return true;
      }
      return false;
    }
  };

  const logout = () => {
    db.logout();
    clearApiToken();
    setUser(null);
  };

  const updateSettings = (newSettings: Setting) => {
    db.updateSettings(newSettings);
    setSettings(newSettings);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      login,
      logout,
      settings,
      updateSettings,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
