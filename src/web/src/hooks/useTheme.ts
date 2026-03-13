import { useState, useEffect } from 'react';

const THEMES = ['dark', 'vivid', 'catppuccin', 'vivid-catppuccin'] as const;
export type Theme = typeof THEMES[number];

const THEME_LABELS: Record<Theme, string> = {
  dark: 'Dark',
  vivid: 'Vivid',
  catppuccin: 'Catppuccin',
  'vivid-catppuccin': 'Vivid Catppuccin',
};

export { THEMES, THEME_LABELS };

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem('taurus-theme') as Theme) || 'vivid-catppuccin';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('taurus-theme', theme);
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);
  const cycleTheme = () => {
    const idx = THEMES.indexOf(theme);
    setThemeState(THEMES[(idx + 1) % THEMES.length]);
  };

  return { theme, setTheme, cycleTheme };
}
