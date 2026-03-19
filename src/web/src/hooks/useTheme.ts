import { useLayoutEffect, useState } from 'react';

const THEMES = ['light', 'night', 'dark', 'vivid', 'catppuccin', 'vivid-catppuccin'] as const;
export type Theme = typeof THEMES[number];
export const DEFAULT_THEME: Theme = 'light';

const THEME_STORAGE_KEY = 'taurus-theme';
const THEME_MIGRATION_KEY = 'taurus-theme-clean-light-migrated';

const THEME_LABELS: Record<Theme, string> = {
  light: 'Light',
  night: 'Night CEO',
  dark: 'Dark',
  vivid: 'Vivid',
  catppuccin: 'Catppuccin',
  'vivid-catppuccin': 'Vivid Catppuccin',
};

const THEME_BROWSER_COLORS: Record<Theme, string> = {
  light: '#f7faf7',
  night: '#061316',
  dark: '#0d1117',
  vivid: '#061224',
  catppuccin: '#1e1e2e',
  'vivid-catppuccin': '#1d1d3d',
};

const TERMINAL_THEMES: Record<Theme, {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
}> = {
  light: {
    background: '#f7faf7',
    foreground: '#11181c',
    cursor: '#0f766e',
    selectionBackground: '#bfded8',
  },
  night: {
    background: '#061316',
    foreground: '#dbe7e4',
    cursor: '#63e6cf',
    selectionBackground: '#17353c',
  },
  dark: {
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursor: '#58a6ff',
    selectionBackground: '#264f78',
  },
  vivid: {
    background: '#061224',
    foreground: '#bbd3eb',
    cursor: '#00baff',
    selectionBackground: '#16395b',
  },
  catppuccin: {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#89b4fa',
    selectionBackground: '#3d3f5a',
  },
  'vivid-catppuccin': {
    background: '#1d1d3d',
    foreground: '#c4d6ff',
    cursor: '#62b8ff',
    selectionBackground: '#42466c',
  },
};

export { THEMES, THEME_LABELS };

function isTheme(value: string | null): value is Theme {
  return value !== null && THEMES.includes(value as Theme);
}

export function resolveTheme(storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined): Theme {
  if (!storage) return DEFAULT_THEME;

  try {
    let stored = storage.getItem(THEME_STORAGE_KEY);
    const migrated = storage.getItem(THEME_MIGRATION_KEY) === '1';

    if (!migrated) {
      storage.setItem(THEME_MIGRATION_KEY, '1');
      if (!stored || stored === 'vivid-catppuccin') {
        storage.setItem(THEME_STORAGE_KEY, DEFAULT_THEME);
        return DEFAULT_THEME;
      }
    }

    if (!isTheme(stored)) {
      storage.setItem(THEME_STORAGE_KEY, DEFAULT_THEME);
      return DEFAULT_THEME;
    }

    return stored;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: Theme, target: Document = document) {
  target.documentElement.setAttribute('data-theme', theme);
  target.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  target.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_BROWSER_COLORS[theme]);
}

export function getMonacoTheme(theme: Theme): 'vs' | 'vs-dark' {
  return theme === 'light' ? 'vs' : 'vs-dark';
}

export function getTerminalTheme(theme: Theme) {
  return TERMINAL_THEMES[theme];
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    return resolveTheme(window.localStorage);
  });

  useLayoutEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);
  const cycleTheme = () => {
    const idx = THEMES.indexOf(theme);
    setThemeState(THEMES[(idx + 1) % THEMES.length]);
  };

  return { theme, setTheme, cycleTheme };
}
