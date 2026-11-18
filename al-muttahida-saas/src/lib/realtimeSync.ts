import { useEffect, useRef } from 'react';
import { getApiToken, getServerApiUrl, isApiMode } from './apiClient';

let activeEventSource: EventSource | null = null;
let reconnectTimer: number | null = null;
const entityTimers = new Map<string, number>();

function emitDebouncedChange(entity: string, action?: string, id?: string) {
  const existing = entityTimers.get(entity);
  if (existing) {
    window.clearTimeout(existing);
  }
  const timer = window.setTimeout(() => {
    entityTimers.delete(entity);
    window.dispatchEvent(new CustomEvent('erp:data-changed', { detail: { entity, action, id } }));
  }, 350);
  entityTimers.set(entity, timer);
}

export function startRealtimeSync() {
  if (!isApiMode() || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
  const token = getApiToken();
  if (!token) return;

  if (activeEventSource) {
    return;
  }

  const base = getServerApiUrl().replace(/\/+$/, '');
  const streamUrl = `${base}/events?token=${encodeURIComponent(token)}`;
  const es = new EventSource(streamUrl);
  activeEventSource = es;

  es.addEventListener('data-change', (evt) => {
    try {
      const payload = JSON.parse((evt as MessageEvent).data) as { entity?: string; action?: string; id?: string };
      if (payload?.entity) {
        emitDebouncedChange(payload.entity, payload.action, payload.id);
      }
    } catch {
      // Ignore malformed SSE payload
    }
  });

  es.onerror = () => {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      startRealtimeSync();
    }, 4000);
  };
}

export function stopRealtimeSync() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }
  for (const timer of entityTimers.values()) {
    window.clearTimeout(timer);
  }
  entityTimers.clear();
}

export function useRealtimeSync(entities: string[], onSync: () => void) {
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  const entitiesKey = entities.join(',');

  useEffect(() => {
    if (!isApiMode()) return;
    const allowed = new Set(entitiesKey.split(',').filter(Boolean));
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ entity?: string }>).detail;
      if (detail?.entity && allowed.has(detail.entity)) {
        onSyncRef.current();
      }
    };
    window.addEventListener('erp:data-changed', handler);
    return () => window.removeEventListener('erp:data-changed', handler);
  }, [entitiesKey]);
}
