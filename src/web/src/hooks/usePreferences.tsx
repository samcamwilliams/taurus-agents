import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export const OUTPUT_STYLES = ['compact', 'detailed'] as const;
export type OutputStyle = typeof OUTPUT_STYLES[number];

export const CHANNEL_INDICATOR_MODES = ['animated', 'static', 'muted'] as const;
export type ChannelIndicatorMode = typeof CHANNEL_INDICATOR_MODES[number];

export interface AppearancePreferences {
  outputStyle: OutputStyle;
  channelIndicators: ChannelIndicatorMode;
  channelIndicatorOverrides: Record<string, ChannelIndicatorMode>;
}

const DEFAULT_PREFERENCES: AppearancePreferences = {
  outputStyle: 'compact',
  channelIndicators: 'animated',
  channelIndicatorOverrides: {},
};

const STORAGE_KEY = 'taurus-preferences';

function isOutputStyle(value: unknown): value is OutputStyle {
  return typeof value === 'string' && OUTPUT_STYLES.includes(value as OutputStyle);
}

function isChannelIndicatorMode(value: unknown): value is ChannelIndicatorMode {
  return typeof value === 'string' && CHANNEL_INDICATOR_MODES.includes(value as ChannelIndicatorMode);
}

function normalizeOverrides(value: unknown): Record<string, ChannelIndicatorMode> {
  if (!value || typeof value !== 'object') return {};

  const normalized: Record<string, ChannelIndicatorMode> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === 'muted') normalized[key] = 'muted';
  }
  return normalized;
}

function normalizePreferences(value: unknown): AppearancePreferences {
  if (!value || typeof value !== 'object') return DEFAULT_PREFERENCES;

  const raw = value as Record<string, unknown>;
  const outputStyle = isOutputStyle(raw.outputStyle) ? raw.outputStyle : DEFAULT_PREFERENCES.outputStyle;
  const channelIndicators = isChannelIndicatorMode(raw.channelIndicators) ? raw.channelIndicators : DEFAULT_PREFERENCES.channelIndicators;
  const channelIndicatorOverrides = normalizeOverrides(raw.channelIndicatorOverrides);

  return { outputStyle, channelIndicators, channelIndicatorOverrides };
}

type PreferencesContextValue = AppearancePreferences & {
  hydratePreferences: (next: Partial<AppearancePreferences>) => void;
  setOutputStyle: (style: OutputStyle) => void;
  setChannelIndicators: (mode: ChannelIndicatorMode) => void;
  setChannelIndicatorOverrides: (overrides: Record<string, ChannelIndicatorMode>) => void;
  setChannelIndicatorOverride: (key: string, mode: ChannelIndicatorMode | null) => void;
  getChannelIndicatorMode: (key?: string | null) => ChannelIndicatorMode;
  getChannelIndicatorOverride: (key: string) => ChannelIndicatorMode | null;
};

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<AppearancePreferences>(() => {
    if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
    try {
      return normalizePreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
    } catch {
      return DEFAULT_PREFERENCES;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {}
  }, [preferences]);

  const value = useMemo<PreferencesContextValue>(() => ({
    ...preferences,
    hydratePreferences(next) {
      setPreferences((current) => normalizePreferences({
        ...current,
        ...next,
      }));
    },
    setOutputStyle(style) {
      setPreferences((current) => normalizePreferences({ ...current, outputStyle: style }));
    },
    setChannelIndicators(mode) {
      setPreferences((current) => normalizePreferences({
        ...current,
        channelIndicators: mode,
        channelIndicatorOverrides: current.channelIndicatorOverrides,
      }));
    },
    setChannelIndicatorOverrides(overrides) {
      setPreferences((current) => normalizePreferences({
        ...current,
        channelIndicatorOverrides: overrides,
      }));
    },
    setChannelIndicatorOverride(key, mode) {
      setPreferences((current) => {
        const nextOverrides = { ...current.channelIndicatorOverrides };
        if (!mode || mode === current.channelIndicators) delete nextOverrides[key];
        else nextOverrides[key] = mode;
        return normalizePreferences({
          ...current,
          channelIndicatorOverrides: nextOverrides,
        });
      });
    },
    getChannelIndicatorMode(key) {
      if (!key) return preferences.channelIndicators;
      return preferences.channelIndicatorOverrides[key] ?? preferences.channelIndicators;
    },
    getChannelIndicatorOverride(key) {
      return preferences.channelIndicatorOverrides[key] ?? null;
    },
  }), [preferences]);

  return createElement(PreferencesContext.Provider, { value }, children);
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within PreferencesProvider');
  }
  return context;
}
