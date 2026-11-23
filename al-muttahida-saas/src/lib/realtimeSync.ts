import { useEffect, useRef } from 'react';
import { getApiToken, isApiMode, resolveApiBaseUrl } from './apiClient';

let activeEventSource: EventSource | null = null;
let activeStreamUrl = '';
let reconnectTimer: number | null = null;
let fallbackPollTimer: number | null = null;
let sseConnected = false;
let lastSseActivityAt = 0;
let globalListenersRegistered = false;
const entityTimers = new Map<string, number>();

function emitDebouncedChange(entity: string, action?: string, id?: string) {
  const existing = entityTimers.get(entity);
  if (existing) {
    window.clearTimeout(existing);
  }
  const timer = window.setTimeout(() => {
    entityTimers.delete(entity);
    window.dispatchEvent(new CustomEvent('erp:data-changed', { detail: { entity, action, id } }));
  }, 300);
  entityTimers.set(entity, timer);
}

function closeActiveEventSource() {
  if (activeEventSource) {
    try {
      activeEventSource.close();
    } catch {
      /* ignore */
    }
    activeEventSource = null;
  }
  activeStreamUrl = '';
  sseConnected = false;
}

function stopFallbackPoll() {
  if (fallbackPollTimer) {
    window.clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
}

function startFallbackPoll() {
  if (fallbackPollTimer || typeof window === 'undefined') return;
  fallbackPollTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible' || !getApiToken()) return;
    const isStale = Date.now() - lastSseActivityAt > 10000;
    if (!sseConnected || isStale) {
      window.dispatchEvent(new CustomEvent('erp:data-changed', { detail: { entity: '*', action: 'poll' } }));
    }
  }, 8000);
}

export function startRealtimeSync() {
  if (!isApiMode() || typeof window === 'undefined' || typeof EventSource === 'undefined') return;

  if (!globalListenersRegistered) {
    globalListenersRegistered = true;
    const forceReconnect = () => {
      closeActiveEventSource();
      startRealtimeSync();
    };
    window.addEventListener('online', forceReconnect);
    window.addEventListener('erp:api-url-changed', forceReconnect);
  }

  const token = getApiToken();
  if (!token) return;

  const base = resolveApiBaseUrl().replace(/\/+$/, '');
  const streamUrl = `${base}/events?token=${encodeURIComponent(token)}`;

  if (activeEventSource) {
    if (activeEventSource.readyState === EventSource.CLOSED || activeStreamUrl !== streamUrl) {
      closeActiveEventSource();
    } else {
      startFallbackPoll();
      return;
    }
  }

  activeStreamUrl = streamUrl;
  const es = new EventSource(streamUrl);
  activeEventSource = es;

  startFallbackPoll();

  const markAlive = () => {
    sseConnected = true;
    lastSseActivityAt = Date.now();
  };

  es.onopen = markAlive;
  es.addEventListener('connected', markAlive);
  es.addEventListener('heartbeat', markAlive);

  es.addEventListener('data-change', (evt) => {
    markAlive();
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
    closeActiveEventSource();
    startFallbackPoll();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      startRealtimeSync();
    }, 3000);
  };
}

export function stopRealtimeSync() {
  stopFallbackPoll();
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  closeActiveEventSource();
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
      if (detail?.entity === '*' || (detail?.entity && allowed.has(detail.entity))) {
        onSyncRef.current();
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        onSyncRef.current();
      }
    };
    const handleFocus = () => {
      onSyncRef.current();
    };
    window.addEventListener('erp:data-changed', handler);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('erp:data-changed', handler);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [entitiesKey]);
}
