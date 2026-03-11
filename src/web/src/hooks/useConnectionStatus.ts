import { useState, useEffect } from 'react';

type ConnectionState = 'connected' | 'disconnected' | 'connecting';

const POLL_INTERVAL = 5_000; // 5s
const TIMEOUT = 3_000;       // 3s per health check

export function useConnectionStatus(): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting');

  useEffect(() => {
    let mounted = true;

    async function check() {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
        await fetch('/api/health', { signal: ctrl.signal });
        clearTimeout(timer);
        if (mounted) setState('connected');
      } catch {
        if (mounted) setState('disconnected');
      }
    }

    check();
    const id = setInterval(check, POLL_INTERVAL);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  return state;
}
