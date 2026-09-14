/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { act } from 'react';
import { describe, expect, it } from 'bun:test';
import { renderHook } from '../../test-utils/render.js';
import { hasDialogRequest } from '../../test-utils/dialogStore.js';
import { AppDispatchProvider } from '../contexts/AppDispatchContext.js';
import {
  appReducer,
  initialAppState,
  type AppAction,
} from '../reducers/appReducer.js';
import { useAuthCommand } from './useAuthCommand.js';
import { SettingScope } from '../../config/settings.js';
import { createDialogOpeners } from '../stores/dialog/dialogOpeners.js';
import { createDialogStore } from '../stores/dialog/dialogStore.js';
import { createSettingsProfileStore } from '../stores/settings/settingsStore.js';

describe('useAuthCommand', () => {
  it('dismisses auth and clears its error without releasing the relogin gate', async () => {
    const store = createDialogStore();
    const dialogs = createDialogOpeners(store);
    const settings = createSettingsProfileStore({
      authError: 'Authentication failed',
    });
    let appState = { ...initialAppState, needsRelogin: true };
    const dispatch = (action: AppAction): void => {
      appState = appReducer(appState, action);
    };
    dialogs.auth.open({});
    const { result, unmount } = renderHook(
      () => useAuthCommand(dialogs, settings.commands.setAuthError),
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={dispatch}>{children}</AppDispatchProvider>
        ),
      },
    );

    await act(async () => {
      await result.current.handleAuthSelect('anthropic', SettingScope.User);
    });

    expect(hasDialogRequest(store, 'auth')).toBe(false);
    expect(settings.store.getState().authError).toBeNull();
    expect(appState.needsRelogin).toBe(true);
    unmount();
  });
});
