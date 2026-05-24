import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, Setting } from '../types';
import * as db from '../lib/storage';
import { api, clearApiToken } from '../lib/apiClient';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  settings: Setting;
  updateSettings: (settings: Setting) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Setting>(db.getSettings());

  useEffect(() => {
    db.initializeDatabase();
    const currentUser = db.getCurrentUser();
    setUser(currentUser);
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      const { token, user: apiUser } = await api.login(email, password);
      localStorage.setItem('api_token', token);
      const mappedUser: User = {
        id: apiUser.id,
        name: apiUser.name,
        email,
        password: '',
        role: apiUser.role as User['role'],
        createdAt: new Date().toISOString(),
        isActive: true,
      };
      setUser(mappedUser);
      return true;
    } catch {
      // fallback to legacy local mode
      const loggedInUser = db.login(email, password);
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
