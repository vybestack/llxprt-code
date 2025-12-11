import { useMemo, useState, useCallback } from 'react';
import type { ThemeDefinition } from './theme';
import { DEFAULT_THEME_SLUG, findTheme, loadThemes } from './theme';

export interface ThemeState {
  readonly themes: ThemeDefinition[];
  readonly theme: ThemeDefinition;
  readonly setThemeBySlug: (slug: string) => void;
}

export function useThemeManager(): ThemeState {
  const themes = useMemo(() => loadThemes(), []);
  const fallback = useMemo(() => selectInitialTheme(themes), [themes]);
  const [theme, setTheme] = useState<ThemeDefinition>(fallback);

  const setThemeBySlug = useCallback(
    (slug: string) => {
      const next = findTheme(themes, slug);
      if (next) {
        setTheme(next);
      }
    },
    [themes],
  );

  return { themes, theme, setThemeBySlug };
}

function selectInitialTheme(themes: ThemeDefinition[]): ThemeDefinition {
  if (themes.length === 0) {
    return {
      name: 'Fallback',
      slug: 'fallback',
      kind: 'dark',
      colors: {
        background: '#0f172a',
        panel: {
          bg: '#0f172a',
          border: '#475569',
          headerBg: '#0f172a',
          headerFg: '#e5e7eb',
        },
        text: {
          primary: '#e5e7eb',
          muted: '#94a3b8',
          user: '#7dd3fc',
          responder: '#facc15',
          thinking: '#94a3b8',
          tool: '#c084fc',
        },
        input: {
          bg: '#0f172a',
          fg: '#e5e7eb',
          placeholder: '#94a3b8',
          border: '#475569',
        },
        status: { fg: '#a3e635', muted: '#94a3b8' },
        accent: {
          primary: '#38bdf8',
          secondary: '#a78bfa',
          warning: '#facc15',
          error: '#ef4444',
          success: '#22c55e',
        },
        selection: { fg: '#0f172a', bg: '#38bdf8' },
        diff: {
          addedBg: '#166534',
          addedFg: '#e5e7eb',
          removedBg: '#7f1d1d',
          removedFg: '#e5e7eb',
        },
        scrollbar: { thumb: '#38bdf8', track: '#475569' },
        message: {
          userBorder: '#7dd3fc',
          systemBorder: '#facc15',
          systemText: '#facc15',
          systemBg: '#0f172a',
        },
      },
    };
  }
  const preferred = findTheme(themes, DEFAULT_THEME_SLUG);
  return preferred ?? themes[0];
}
