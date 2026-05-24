import { Notification } from '../../types';
import { DB_KEYS, getStorage, setStorage, generateId } from './core';

export function getNotifications(): Notification[] {
  return getStorage<Notification>(DB_KEYS.NOTIFICATIONS);
}

export function createNotification(notification: Omit<Notification, 'id' | 'createdAt' | 'isRead'>): Notification {
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

export function markNotificationRead(id: string): void {
  const notifications = getStorage<Notification>(DB_KEYS.NOTIFICATIONS);
  const index = notifications.findIndex((n) => n.id === id);
  if (index !== -1) {
    notifications[index].isRead = true;
    setStorage(DB_KEYS.NOTIFICATIONS, notifications);
  }
}

export function markAllNotificationsRead(): void {
  const notifications = getStorage<Notification>(DB_KEYS.NOTIFICATIONS);
  notifications.forEach((n) => (n.isRead = true));
  setStorage(DB_KEYS.NOTIFICATIONS, notifications);
}
