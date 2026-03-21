/// <reference types="vite/client" />

export async function registerPwaServiceWorker(): Promise<void> {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('Failed to register Taurus service worker', err);
  }
}
