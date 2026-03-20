import { useState, useRef, useEffect } from 'react';
import { User, ChevronDown, LogOut, UserCog } from 'lucide-react';
import { getCsrfToken, setCsrfToken, clearTaurusCaches } from '../api';
import { AccountSettingsModal } from './AccountSettingsModal';

interface UserMenuProps {
  username?: string | null;
  onLogout: () => void;
}

export function UserMenu({ username, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function handleLogout() {
    const csrf = getCsrfToken();
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
    });
    // Clear SW caches so a different user on this browser gets a fresh page
    await clearTaurusCaches();
    setCsrfToken(null);
    setOpen(false);
    onLogout();
  }

  return (
    <>
      <div className="user-menu" ref={ref}>
        <button className="btn icon-btn user-menu__trigger" onClick={() => setOpen(v => !v)}>
          <User size={13} />
          {username && <span className="user-menu__name">{username}</span>}
          <ChevronDown size={10} />
        </button>
        {open && (
          <div className="user-menu__dropdown">
            <button className="user-menu__item" onClick={() => { setOpen(false); setShowSettings(true); }}>
              <UserCog size={13} /> <span style={{ whiteSpace: 'nowrap' }}>Profile</span>
            </button>
            <button className="user-menu__item" onClick={handleLogout}>
              <LogOut size={13} /> Sign out
            </button>
          </div>
        )}
      </div>
      {showSettings && <AccountSettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
