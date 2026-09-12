/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import { renderHook, createMockSettings } from '../../../test-utils/render.js';
import { AppDispatchProvider } from '../../contexts/AppDispatchContext.js';
import { useThemeCommand } from '../../hooks/useThemeCommand.js';
import { createDialogStore } from '../dialog/dialogStore.js';
import { createDialogOpeners } from '../dialog/dialogOpeners.js';
import { createTurnStore } from '../turn/turnStore.js';
import { createSettingsProfileStore } from './settingsStore.js';
import { initialDialogActions } from './dialogActions.js';
import { useStoreSelector } from '../useStoreSelector.js';

describe('dialog command store flow', () => {
  it('initial dialog actions fail fast before the writer commits', () => {
    const actions = initialDialogActions();
    const invocations = [
      actions.openThemeDialog,
      actions.openEditorDialog,
      actions.openProviderDialog,
      actions.openLoadProfileDialog,
      actions.openCreateProfileDialog,
      actions.openProfileListDialog,
      () => actions.viewProfileDetail('profile'),
      () => actions.openProfileEditor('profile'),
      actions.welcomeActions.resetAndReopen,
    ];
    for (const invoke of invocations) {
      expect(invoke).toThrow(
        'Dialog actions invoked before the dialog writer committed',
      );
    }
  });

  it('preserves theme policy when input invokes a published dialog loader', () => {
    const previous = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    const dialogs = createDialogStore();
    const openers = createDialogOpeners(dialogs);
    const turn = createTurnStore();
    const settings = createSettingsProfileStore();
    const loaded = createMockSettings({ ui: { theme: 'Dracula' } });
    const { result, unmount } = renderHook(
      () => {
        const theme = useThemeCommand(
          loaded,
          openers,
          turn.commands.addItem,
          settings.commands.setThemeError,
        );
        const actions = useStoreSelector(
          settings.store,
          (s) => s.dialogActions,
        );
        return { theme, actions };
      },
      {
        wrapper: ({ children }) => (
          <AppDispatchProvider value={() => {}}>{children}</AppDispatchProvider>
        ),
      },
    );
    try {
      act(() => {
        settings.commands.setDialogActions({
          ...settings.store.getState().dialogActions,
          openThemeDialog: result.current.theme.openThemeDialog,
        });
      });
      act(() => result.current.actions.openThemeDialog());
      expect(dialogs.store.getState().requests).toHaveLength(0);
      expect(
        turn.store
          .getState()
          .history.some(
            (item) => item.type === 'info' && item.text.includes('NO_COLOR'),
          ),
      ).toBe(true);
    } finally {
      unmount();
      if (previous === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previous;
    }
  });

  it('defaults startupGuardsInitialized to false until the guard command sets it', () => {
    const settings = createSettingsProfileStore();
    expect(settings.store.getState().startupGuardsInitialized).toBe(false);
    settings.commands.setStartupGuardsInitialized(true);
    expect(settings.store.getState().startupGuardsInitialized).toBe(true);
  });
});
