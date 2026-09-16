/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { renderHook } from '../../test-utils/render.js';
import { hasDialogRequest } from '../../test-utils/dialogStore.js';
import { AppDispatchProvider } from '../contexts/AppDispatchContext.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { DEFAULT_THEME, themeManager } from '../themes/theme-manager.js';
import type { CustomTheme } from '../themes/theme.js';
import { createSettingsProfileStore } from '../stores/settings/settingsStore.js';
import {
  appReducer,
  initialAppState,
  type AppAction,
} from '../reducers/appReducer.js';
import { useThemeCommand } from './useThemeCommand.js';

describe('theme selection', () => {
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

  function setup(customThemes: Record<string, CustomTheme>) {
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
    const settingsStore = createSettingsProfileStore();
    const dialogs = createDialogOpeners(store);
    let appState = initialAppState;
    const themeRevisions: number[] = [];
    const dispatch = (action: AppAction): void => {
      appState = appReducer(appState, action);
      themeRevisions.push(appState.themeRevision);
    };
    const hook = renderHook(
      () =>
        useThemeCommand(
          settings,
          dialogs,
          () => {},
          settingsStore.commands.setThemeError,
        ),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={dispatch}>{children}</AppDispatchProvider>
        ),
      },
    );
    act(() => dialogs.theme.open({}));
    return { ...hook, file, settings, store, settingsStore, themeRevisions };
  }

  const cases: Array<{
    themeName: string;
    customThemes: Record<string, CustomTheme>;
    alreadyRegistered: boolean;
  }> = [
    { themeName: 'Dracula', customThemes: {}, alreadyRegistered: true },
    {
      themeName: 'Local',
      customThemes: {
        Local: {
          ...DEFAULT_THEME.colors,
          name: 'Local',
          type: 'custom',
          Background: '#123456',
        },
      },
      alreadyRegistered: false,
    },
  ];
  for (const { themeName, customThemes, alreadyRegistered } of cases) {
    it(`persists and applies ${themeName} selection`, () => {
      const {
        result,
        unmount,
        file,
        settings,
        store,
        settingsStore,
        themeRevisions,
      } = setup(customThemes);
      expect(themeManager.findThemeByName(themeName) !== undefined).toBe(
        alreadyRegistered,
      );
      act(() => result.current.handleThemeSelect(themeName, SettingScope.User));
      expect(settings.merged.ui.theme).toBe(themeName);
      expect(readFileSync(file, 'utf8')).toContain(themeName);
      expect(themeManager.getActiveTheme().name).toBe(themeName);
      expect(themeRevisions).toStrictEqual([1]);
      expect(settingsStore.store.getState().themeError).toBeNull();
      expect(hasDialogRequest(store, 'theme')).toBe(false);
      unmount();
    });
  }

  for (const persisted of [false, true]) {
    it(`dismisses an undefined selection without ${persisted ? 'modifying' : 'creating'} settings`, () => {
      const { result, file, settings, store, settingsStore, unmount } = setup(
        {},
      );
      if (persisted) {
        settings.setValue(SettingScope.User, 'ui.theme', 'Default');
      }
      const previousFile = persisted ? readFileSync(file, 'utf8') : undefined;
      act(() =>
        result.current.handleThemeSelect('DoesNotExist', SettingScope.User),
      );
      expect(settingsStore.store.getState().themeError).not.toBeNull();
      expect(hasDialogRequest(store, 'theme')).toBe(true);

      act(() => result.current.handleThemeSelect(undefined, SettingScope.User));

      expect(hasDialogRequest(store, 'theme')).toBe(false);
      expect(settingsStore.store.getState().themeError).toBeNull();
      expect(settings.merged.ui.theme).toBe('Default');
      expect(existsSync(file)).toBe(persisted);
      const currentFile = existsSync(file)
        ? readFileSync(file, 'utf8')
        : undefined;
      expect(currentFile).toBe(previousFile);
      unmount();
    });
  }

  it('does not persist a malformed custom theme and leaves its error visible', () => {
    const { result, file, settings, store, settingsStore, unmount } = setup({
      Broken: {
        ...DEFAULT_THEME.colors,
        name: 'Broken',
        type: 'custom',
        Background: 'invalid-color',
      },
    });
    act(() => result.current.handleThemeSelect('Broken', SettingScope.User));
    expect(existsSync(file)).toBe(false);
    expect(settings.merged.ui.theme).toBe('Default');
    expect(settingsStore.store.getState().themeError).toBe(
      'Theme "Broken" not found.',
    );
    expect(hasDialogRequest(store, 'theme')).toBe(true);
    unmount();
  });

  it('leaves an unknown theme unpersisted and reports the error in the open picker', () => {
    const {
      result,
      unmount,
      file,
      settings,
      store,
      settingsStore,
      themeRevisions,
    } = setup({});
    const previousTheme = themeManager.getActiveTheme().name;
    act(() =>
      result.current.handleThemeSelect('DoesNotExist', SettingScope.User),
    );
    expect(settings.merged.ui.theme).toBe('Default');
    expect(existsSync(file)).toBe(false);
    expect(themeManager.getActiveTheme().name).toBe(previousTheme);
    expect(themeRevisions).toHaveLength(0);
    expect(settingsStore.store.getState().themeError).toBe(
      'Theme "DoesNotExist" not found.',
    );
    expect(hasDialogRequest(store, 'theme')).toBe(true);
    unmount();
  });
});
