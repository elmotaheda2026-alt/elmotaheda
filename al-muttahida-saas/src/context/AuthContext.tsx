import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, Setting } from '../types';
import * as db from '../lib/storage';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => boolean;
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

  const login = (email: string, password: string): boolean => {
    const loggedInUser = db.login(email, password);
    if (loggedInUser) {
      setUser(loggedInUser);
      return true;
    }
    return false;
  };

  const logout = () => {
    db.logout();
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
