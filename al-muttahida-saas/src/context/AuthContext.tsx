import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Permission, User, Setting, UserPermissions } from '../types';
import * as db from '../lib/storage';
import { api, clearApiToken, getApiUser, isApiMode, setApiSession, updateApiUser } from '../lib/apiClient';
import { setDynamicRolePermissions } from '../lib/permissions';
import { setDynamicPaymentChannels } from '../lib/paymentChannels';
import { useRealtimeSync } from '../lib/realtimeSync';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  settings: Setting;
  updateSettings: (settings: Setting) => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [settings, setSettings] = useState<Setting>(() => {
    try {
      return db.getSettings();
    } catch {
      return {} as Setting;
    }
  });

  const syncLiveSession = async () => {
    if (!isApiMode()) return;
    const [settingsRes, meRes] = await Promise.allSettled([
      db.syncSettings(),
      api.getMe(),
    ]);

    let nextRolePerms: Partial<Record<User['role'], Permission[]>> | undefined;
    if (settingsRes.status === 'fulfilled' && settingsRes.value) {
      nextRolePerms = settingsRes.value.rolePermissions;
      setDynamicRolePermissions(nextRolePerms);
      setDynamicPaymentChannels(settingsRes.value.paymentChannels);
      setSettings(settingsRes.value);
    }

    if (meRes.status === 'fulfilled' && meRes.value?.user) {
      const me = meRes.value;
      if (!nextRolePerms && me.rolePermissions) {
        const rp = me.rolePermissions as Partial<Record<User['role'], Permission[]>>;
        setDynamicRolePermissions(rp);
        setSettings((prev) => ({
          ...prev,
          rolePermissions: rp,
        }));
      }
      setUser((prev) => {
        if (!prev) return prev;
        const nextUser: User = {
          ...prev,
          name: me.user.name || prev.name,
          username: me.user.username || prev.username,
          role: me.user.role as User['role'],
          permissions:
            me.user.role === 'admin'
              ? undefined
              : ((me.user.permissions as UserPermissions | null | undefined) ?? undefined),
        };
        updateApiUser(nextUser);
        return nextUser;
      });
    }
  };

  const refreshSettings = async () => {
    if (isApiMode()) {
      await syncLiveSession();
    } else {
      const local = db.getSettings();
      setDynamicRolePermissions(local?.rolePermissions);
      setDynamicPaymentChannels(local?.paymentChannels);
      setSettings(local);
    }
  };

  useEffect(() => {
    try {
      // Purge legacy persistent tokens from localStorage on startup to enforce per-session login
      try {
        localStorage.removeItem('api_token');
        localStorage.removeItem('api_user');
        localStorage.removeItem('almuttahida_auth');
      } catch {
        // Ignore storage access errors when cleaning legacy tokens
      }

      if (isApiMode()) {
        const currentApiUser = getApiUser<User>();
        setUser(currentApiUser);
        if (currentApiUser) {
          void syncLiveSession();
        }
      } else {
        db.initializeDatabase();
        setUser(db.getCurrentUser());
        setSettings(db.getSettings());
      }
    } catch (e) {
      console.error('Failed to initialize auth/database:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Keep dynamic role permissions and payment channels in sync synchronously on render
  setDynamicRolePermissions(settings?.rolePermissions);
  setDynamicPaymentChannels(settings?.paymentChannels);

  useEffect(() => {
    setDynamicRolePermissions(settings?.rolePermissions);
    setDynamicPaymentChannels(settings?.paymentChannels);
  }, [settings?.rolePermissions, settings?.paymentChannels]);

  useEffect(() => {
    const handleSessionExpired = () => {
      setUser(null);
    };
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired);
  }, []);

  useRealtimeSync(['settings', 'users'], () => {
    if (isApiMode() && user) {
      void syncLiveSession();
    }
  });

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
        permissions: apiUser.role === 'admin' ? undefined : permissions,
        createdAt: new Date().toISOString(),
        isActive: true,
      };
      setApiSession(token, mappedUser);
      setUser(mappedUser);
      await db.syncSettings()
        .then((fresh) => {
          setDynamicRolePermissions(fresh?.rolePermissions);
          setDynamicPaymentChannels(fresh?.paymentChannels);
          setSettings(fresh);
        })
        .catch(() => {});
      return true;
    } catch (e) {
      if (isApiMode()) {
        console.warn('API login failed', e);
        clearApiToken();
        setUser(null);
        return false;
      }

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

  const updateSettings = async (newSettings: Setting) => {
    await db.updateSettings(newSettings);
    setDynamicPaymentChannels(newSettings?.paymentChannels);
    setSettings(newSettings);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
      settings,
      updateSettings,
      refreshSettings,
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

