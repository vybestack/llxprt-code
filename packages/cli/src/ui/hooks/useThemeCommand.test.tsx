/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { renderHook } from '../../test-utils/render.js';
import { AppDispatchProvider } from '../contexts/AppDispatchContext.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { themeManager } from '../themes/theme-manager.js';
import type { CustomTheme } from '../themes/theme.js';
import { useThemeCommand } from './useThemeCommand.js';

describe('built-in theme selection', () => {
  const directories: string[] = [];
  const originalTheme = themeManager.getActiveTheme().name;
  const originalNoColor = process.env.NO_COLOR;
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true });
    themeManager.loadCustomThemes();
    themeManager.setActiveTheme(originalTheme);
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
  });

  const customThemeMaps: Array<Record<string, CustomTheme>> = [
    {},
    { Local: { name: 'Local', type: 'custom', Background: '#000000' } },
  ];
  for (const customThemes of customThemeMaps) {
    it(`persists built-in selection with ${Object.keys(customThemes).length} custom themes`, () => {
      delete process.env.NO_COLOR;
      const directory = mkdtempSync(join(tmpdir(), 'theme-2536-'));
      directories.push(directory);
      const file = join(directory, 'settings.json');
      const settings = new LoadedSettings(
        { path: '', settings: {} },
        { path: '', settings: {} },
        { path: file, settings: { ui: { theme: 'Default', customThemes } } },
        { path: '', settings: {} },
        true,
      );
      const store = createDialogStore();
      const dialogs = createDialogOpeners(store);
      const { result, unmount } = renderHook(
        () => useThemeCommand(settings, dialogs, () => {}),
        {
          wrapper: ({ children }) => (
            <AppDispatchProvider value={() => {}}>
              {children}
            </AppDispatchProvider>
          ),
        },
      );
      act(() => result.current.handleThemeSelect('Dracula', SettingScope.User));
      expect(settings.merged.ui.theme).toBe('Dracula');
      expect(readFileSync(file, 'utf8')).toContain('Dracula');
      expect(themeManager.getActiveTheme().name).toBe('Dracula');
      expect(store.store.getState().requests).toHaveLength(0);
      unmount();
    });
  }
});
