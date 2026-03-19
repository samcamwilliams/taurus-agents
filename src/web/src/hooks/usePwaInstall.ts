import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function getStandaloneState(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function usePwaInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(() => getStandaloneState());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(display-mode: standalone)');
    const handleStandaloneChange = () => setIsInstalled(getStandaloneState());
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setPromptEvent(null);
      setIsInstalled(true);
    };

    if ('addEventListener' in media) {
      media.addEventListener('change', handleStandaloneChange);
    } else {
      media.addListener(handleStandaloneChange);
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      if ('removeEventListener' in media) {
        media.removeEventListener('change', handleStandaloneChange);
      } else {
        media.removeListener(handleStandaloneChange);
      }
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    if (!promptEvent) return false;

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
    }
    setPromptEvent(null);
    return choice.outcome === 'accepted';
  }, [promptEvent]);

  return {
    canInstall: !!promptEvent && !isInstalled,
    isInstalled,
    install,
  };
}
