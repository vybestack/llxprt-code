/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
await import('ink-testing-library');
const ink = await import('../../../test-utils/real-ink.js');
void vi.mock('ink', () => ink);
const { createMockSettings, renderWithProviders } = await import(
  '../../test-utils/render.js'
);
const { AppDispatchProvider } = await import(
  '../contexts/AppDispatchContext.js'
);
const { createSettingsProfileStore } = await import(
  '../stores/settings/settingsStore.js'
);
const { createDialogStore, selectDialogOpen } = await import(
  '../stores/dialog/dialogStore.js'
);
const { createDialogOpeners } = await import(
  '../stores/dialog/dialogOpeners.js'
);
const { useStoreSelector } = await import('../stores/useStoreSelector.js');
const { useThemeCommand } = await import('../hooks/useThemeCommand.js');
const { renderThemeDialog, renderEditorDialog } = await import(
  './DialogManagerRenderers.js'
);
const { SettingScope } = await import('../../config/settings.js');

describe('dialog feedback', () => {
  it('explains an invalid saved theme and keeps failed selections visible', async () => {
    const settings = createMockSettings({ ui: { theme: 'MissingSavedTheme' } });
    const display = createSettingsProfileStore();
    const dialogs = createDialogStore();
    const openers = createDialogOpeners(dialogs);
    let selectTheme = (_name: string | undefined) => {};
    const addItem = () => {};
    function Picker() {
      const actions = useThemeCommand(
        settings,
        openers,
        addItem,
        display.commands.setThemeError,
      );
      selectTheme = (name) =>
        actions.handleThemeSelect(name, SettingScope.User);
      const error = useStoreSelector(display.store, (s) => s.themeError);
      return renderThemeDialog(error, actions, settings, false, 24, 0, 80);
    }
    const view = renderWithProviders(
      <AppDispatchProvider value={() => {}}>
        <Picker />
      </AppDispatchProvider>,
      { settings },
    );
    try {
      expect(view.lastFrame()).toContain(
        'Theme "MissingSavedTheme" not found.',
      );
      await act(async () => {
        selectTheme('AnotherMissingTheme');
      });
      expect(view.lastFrame()).toContain(
        'Theme "AnotherMissingTheme" not found.',
      );
      expect(selectDialogOpen(dialogs.store.getState(), 'theme')).toBe(true);
      expect(settings.merged.ui.theme).toBe('MissingSavedTheme');
      await act(async () => {
        selectTheme(undefined);
      });
      expect(selectDialogOpen(dialogs.store.getState(), 'theme')).toBe(false);
    } finally {
      view.unmount();
    }
  });

  it('renders and clears editor feedback from the display store', async () => {
    const display = createSettingsProfileStore();
    const settings = createMockSettings({});
    function Picker() {
      const error = useStoreSelector(display.store, (s) => s.editorError);
      return renderEditorDialog(
        error,
        { handleEditorSelect: () => {} },
        settings,
        () => {},
      );
    }
    const view = renderWithProviders(<Picker />, { settings });
    try {
      await act(async () => {
        display.commands.setEditorError('Failed to save editor preference');
      });
      expect(view.lastFrame()).toContain('Failed to save editor preference');
      await act(async () => {
        display.commands.setEditorError(null);
      });
      expect(view.lastFrame()).not.toContain(
        'Failed to save editor preference',
      );
    } finally {
      view.unmount();
    }
  });
});
