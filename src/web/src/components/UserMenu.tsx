import { useState, useRef, useEffect } from 'react';
import { User, ChevronDown, LogOut } from 'lucide-react';
import { getCsrfToken, setCsrfToken } from '../api';

interface UserMenuProps {
  onLogout: () => void;
}

export function UserMenu({ onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
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
    setCsrfToken(null);
    setOpen(false);
    onLogout();
  }

  return (
    <div className="user-menu" ref={ref}>
      <button className="btn icon-btn user-menu__trigger" onClick={() => setOpen(v => !v)}>
        <User size={13} />
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="user-menu__dropdown">
          <button className="user-menu__item" onClick={handleLogout}>
            <LogOut size={13} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
