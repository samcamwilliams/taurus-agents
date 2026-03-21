import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, X } from 'lucide-react';
import { THEMES, THEME_LABELS, THEME_DESCRIPTIONS, useTheme, type Theme } from '../hooks/useTheme';
import { api } from '../api';

interface ThemePickerProps {
  onClose: () => void;
}

export function ThemePicker({ onClose }: ThemePickerProps) {
  const { theme, setTheme } = useTheme();
  const barRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragOrigin = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const persist = useCallback(async (t: Theme) => {
    try { await api.updatePreferences({ theme: t }); } catch { /* best-effort */ }
  }, []);

  const cycle = useCallback((dir: -1 | 1) => {
    const idx = THEMES.indexOf(theme);
    const next = THEMES[(idx + dir + THEMES.length) % THEMES.length];
    setTheme(next);
    persist(next);
  }, [theme, setTheme, persist]);

  // Keyboard: arrow keys cycle, Escape closes
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); cycle(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); cycle(1); }
      else if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [cycle, onClose]);

  // Drag: grip down → window move/up listeners → clean up on release
  // Supports both mouse and touch.
  const startDrag = useCallback((startX: number, startY: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    dragOrigin.current = { sx: startX, sy: startY, ox: rect.left, oy: rect.top };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startDrag(e.clientX, e.clientY);
    function onMove(ev: MouseEvent) {
      const d = dragOrigin.current!;
      setPos({ x: d.ox + (ev.clientX - d.sx), y: d.oy + (ev.clientY - d.sy) });
    }
    function onUp() {
      dragOrigin.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [startDrag]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);
    function onMove(ev: TouchEvent) {
      ev.preventDefault();
      const t = ev.touches[0];
      const d = dragOrigin.current!;
      setPos({ x: d.ox + (t.clientX - d.sx), y: d.oy + (t.clientY - d.sy) });
    }
    function onEnd() {
      dragOrigin.current = null;
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    }
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
  }, [startDrag]);

  const style: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, bottom: 'auto', transform: 'none' }
    : {};

  return (
    <div className="theme-picker" ref={barRef} style={style}>
      <div className="theme-picker__grip" onMouseDown={handleMouseDown} onTouchStart={handleTouchStart}>
        <GripVertical size={14} />
      </div>
      <button className="theme-picker__arrow" onClick={() => cycle(-1)} title="Previous theme">
        <ChevronLeft size={14} />
      </button>
      <div className="theme-picker__label">
        {/* All labels rendered to reserve the widest size; only the active one is visible */}
        {THEMES.map(t => (
          <span key={t} className="theme-picker__name" aria-hidden={t !== theme ? true : undefined}
            style={t !== theme ? { visibility: 'hidden' } : undefined}>
            {THEME_LABELS[t]}
          </span>
        ))}
        {THEMES.map(t => (
          <span key={t} className="theme-picker__desc" aria-hidden={t !== theme ? true : undefined}
            style={t !== theme ? { visibility: 'hidden' } : undefined}>
            {THEME_DESCRIPTIONS[t]}
          </span>
        ))}
      </div>
      <button className="theme-picker__arrow" onClick={() => cycle(1)} title="Next theme">
        <ChevronRight size={14} />
      </button>
      <button className="theme-picker__close" onClick={onClose} title="Close">
        <X size={12} />
      </button>
    </div>
  );
}
