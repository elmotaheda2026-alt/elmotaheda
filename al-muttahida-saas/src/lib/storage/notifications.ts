import { Notification } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';
import { api, isApiMode } from '../apiClient';

export function getNotifications(): Notification[] {
  return getStorage<Notification>(DB_KEYS.NOTIFICATIONS);
}

export async function syncNotifications(): Promise<void> {
  if (!isApiMode()) return;
  const data = await api.listNotifications();
  setStorage(DB_KEYS.NOTIFICATIONS, data);
}

export async function createNotification(notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>): Promise<Notification> {
  if (isApiMode()) {
    const res = await api.createNotification(notification);
    const newNotification: Notification = {
      ...notification,
      id: res.id,
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    const notifications = getStorage<Notification>(DB_KEYS.NOTIFICATIONS);
    notifications.unshift(newNotification);
    setStorage(DB_KEYS.NOTIFICATIONS, notifications);
    return newNotification;
  }

  const notifications = getStorage<Notification>(DB_KEYS.NOTIFICATIONS);
  const newNotification: Notification = {
    ...notification,
    id: generateId(),
    isRead: false,
    createdAt: new Date().toISOString(),
  };
  notifications.unshift(newNotification);
  setStorage(DB_KEYS.NOTIFICATIONS, notifications);
  return newNotification;
}

export async function markNotificationRead(id: string): Promise<void> {
  if (isApiMode()) {
    await api.markNotificationRead(id);
  }

  const notifications = getStorage<Notification>(DB_KEYS.NOTIFICATIONS);
  const index = notifications.findIndex((n) => n.id === id);
  if (index !== -1) {
    notifications[index].isRead = true;
    setStorage(DB_KEYS.NOTIFICATIONS, notifications);
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  if (isApiMode()) {
    await api.markAllNotificationsRead();
  }

  const notifications = getStorage<Notification>(DB_KEYS.NOTIFICATIONS);
  notifications.forEach((n) => (n.isRead = true));
  setStorage(DB_KEYS.NOTIFICATIONS, notifications);
}
