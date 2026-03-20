import { useCallback, useEffect, useMemo, useState } from 'react';

type ToastType = 'error' | 'info';

type NotificationEventPayload = {
  type: 'agent_notification';
  agentId: string;
  agentName: string;
  runId?: string;
  title: string;
  message: string;
  level?: 'info' | 'success' | 'warning' | 'error';
  tag?: string;
  timestamp: string;
};

const ENABLED_STORAGE_KEY = 'taurus.notifications.enabled';

function getStoredEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ENABLED_STORAGE_KEY) === '1';
}

function setStoredEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? '1' : '0');
}

async function showSystemNotification(event: NotificationEventPayload): Promise<void> {
  const destination = event.runId
    ? `/agents/${event.agentId}/runs/${event.runId}`
    : `/agents/${event.agentId}`;

  const options: NotificationOptions = {
    body: event.message,
    tag: event.tag ?? `agent:${event.agentId}:${event.runId ?? 'latest'}`,
    data: { url: destination },
    icon: '/icons/taurus-icon.svg',
    badge: '/icons/taurus-icon.svg',
  };

  const registration = 'serviceWorker' in navigator
    ? await navigator.serviceWorker.getRegistration()
    : undefined;
  if (registration) {
    await registration.showNotification(event.title, options);
    return;
  }

  new Notification(event.title, options);
}

export function useAgentNotifications(showToast: (message: string, type?: ToastType) => void) {
  const supported = typeof window !== 'undefined' && 'Notification' in window;
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    supported ? Notification.permission : 'unsupported',
  );
  const [enabled, setEnabled] = useState(() => supported && Notification.permission === 'granted' && getStoredEnabled());

  useEffect(() => {
    if (!supported) return;
    if (Notification.permission !== 'granted' && enabled) {
      setEnabled(false);
      setStoredEnabled(false);
    }
  }, [enabled, supported]);

  const enable = useCallback(async () => {
    if (!supported) {
      showToast('This browser does not support notifications.', 'error');
      return false;
    }

    if (permission === 'denied') {
      showToast('Browser notifications are blocked for Taurus.', 'error');
      return false;
    }

    let nextPermission = permission;
    if (nextPermission !== 'granted') {
      nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
    }

    if (nextPermission !== 'granted') {
      showToast('Notifications were not enabled.', 'info');
      return false;
    }

    setEnabled(true);
    setStoredEnabled(true);
    showToast('Notifications enabled for Taurus.', 'info');
    return true;
  }, [permission, showToast, supported]);

  const disable = useCallback(() => {
    setEnabled(false);
    setStoredEnabled(false);
    showToast('Notifications paused for Taurus.', 'info');
  }, [showToast]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryDelay = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function connect() {
      if (disposed) return;
      source = new EventSource('/api/notifications/stream');

      source.onopen = () => { retryDelay = 1000; };

      source.onmessage = (raw) => {
        try {
          const event = JSON.parse(raw.data) as NotificationEventPayload;
          if (event.type !== 'agent_notification') return;

          const toastMessage = `${event.agentName}: ${event.message}`;
          const wantsSystemNotification =
            enabled &&
            permission === 'granted' &&
            (document.visibilityState !== 'visible' || !document.hasFocus());

          if (wantsSystemNotification) {
            showSystemNotification(event).catch(() => {
              showToast(toastMessage, event.level === 'error' ? 'error' : 'info');
            });
            return;
          }

          showToast(toastMessage, event.level === 'error' ? 'error' : 'info');
        } catch {
          // Ignore malformed events.
        }
      };

      source.onerror = () => {
        source?.close();
        source = null;
        if (disposed) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      };
    }

    connect();

    return () => {
      disposed = true;
      source?.close();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [enabled, permission, showToast]);

  const state = useMemo(() => ({
    supported,
    permission,
    enabled,
    enable,
    disable,
  }), [disable, enable, enabled, permission, supported]);

  return state;
}
